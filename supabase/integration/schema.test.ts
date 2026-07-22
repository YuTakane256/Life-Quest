// @vitest-environment node
/**
 * #501 コアスキーマの統合テスト。ローカルSupabaseスタックに対して実行する。
 * 実行条件は spike.test.ts と同じ（env 4種が揃っているときのみ）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const DB_URL = process.env.SUPABASE_DB_URL;
const API_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(DB_URL && API_URL && ANON_KEY && SERVICE_KEY);

const uuid = () => crypto.randomUUID();

async function createUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
    const admin = createClient(API_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.createUser({
        email,
        password: 'password-123',
        email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const client = createClient(API_URL!, ANON_KEY!, { auth: { persistSession: false } });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: 'password-123' });
    if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
    return { id: data.user.id, client };
}

type Batch = {
    next_cursor: number;
    has_more: boolean;
    profiles: { user_id: string; display_name: string | null; version: number }[];
    tasks: { id: string; version: number }[];
    subtasks: { id: string; version: number }[];
    habits: { id: string; version: number }[];
    habit_logs: unknown[];
    rest_days: unknown[];
    user_settings: { user_id: string; version: number }[];
    stats_daily: unknown[];
};

describe.skipIf(!enabled)('#501 コアスキーマ（ローカルSupabase統合）', () => {
    let user: { id: string; client: SupabaseClient };
    let pg: PgClient;

    const pull = async (after: number, max = 200): Promise<Batch> => {
        const { data, error } = await user.client.rpc('pull_sync_batch', {
            p_after_version: after, p_max_versions: max,
        });
        if (error) throw new Error(error.message);
        return data as Batch;
    };

    beforeAll(async () => {
        pg = new PgClient({ connectionString: DB_URL });
        await pg.connect();
        user = await createUser(`schema-${Date.now()}@example.com`);
    }, 30000);

    afterAll(async () => {
        await pg?.end();
    });

    it('pull_sync_batchが8テーブル全てのキーを返し、profilesの変更を含む（指摘#7）', async () => {
        const res = await user.client.rpc('upsert_profile', {
            p_display_name: '冒険者A',
            p_avatar: 'male',
            p_active_title: null,
            p_base_version: null,
            p_key: uuid(),
        });
        expect(res.error).toBeNull();

        const batch = await pull(0);
        for (const key of ['profiles', 'tasks', 'subtasks', 'habits', 'habit_logs', 'rest_days', 'user_settings', 'stats_daily'] as const) {
            expect(Array.isArray(batch[key])).toBe(true);
        }
        expect(batch.profiles).toHaveLength(1);
        expect(batch.profiles[0].display_name).toBe('冒険者A');
        expect(batch.next_cursor).toBeGreaterThan(0);
    });

    it('upsert_profileはbase_version不一致で適用せずconflictと現在値を返す', async () => {
        const current = await pull(0);
        const currentVersion = current.profiles[0].version;

        const conflict = await user.client.rpc('upsert_profile', {
            p_display_name: '古い端末からの上書き',
            p_avatar: null,
            p_active_title: null,
            p_base_version: currentVersion - 1, // 古いbase_version
            p_key: uuid(),
        });
        expect(conflict.error).toBeNull();
        const body = conflict.data as { conflict: boolean; current: { display_name: string } };
        expect(body.conflict).toBe(true);
        expect(body.current.display_name).toBe('冒険者A'); // 変更されていない

        const ok = await user.client.rpc('upsert_profile', {
            p_display_name: '冒険者A改',
            p_avatar: 'male',
            p_active_title: null,
            p_base_version: currentVersion, // 一致
            p_key: uuid(),
        });
        expect(ok.error).toBeNull();
        expect((ok.data as { version: number }).version).toBeGreaterThan(currentVersion);
    });

    it('upsert_user_settings: 4項目を絶対値upsertし、base_version不一致でconflictを返す', async () => {
        const settings = { themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21 };
        const first = await user.client.rpc('upsert_user_settings', {
            p_settings: settings, p_base_version: null, p_key: uuid(),
        });
        expect(first.error).toBeNull();
        const firstVersion = (first.data as { version: number }).version;

        const { rows } = await pg.query('select settings, version from user_settings where user_id=$1', [user.id]);
        expect(rows[0].settings).toEqual(settings);
        expect(Number(rows[0].version)).toBe(firstVersion);

        const conflict = await user.client.rpc('upsert_user_settings', {
            p_settings: { themeMode: 'light', motionMode: 'system', notificationsEnabled: false, habitReminderHour: 8 },
            p_base_version: firstVersion - 1,
            p_key: uuid(),
        });
        expect(conflict.error).toBeNull();
        const conflictBody = conflict.data as { conflict: boolean; current: { settings: unknown } };
        expect(conflictBody.conflict).toBe(true);
        expect(conflictBody.current.settings).toEqual(settings); // 変更されていない

        const applied = await user.client.rpc('upsert_user_settings', {
            p_settings: { themeMode: 'light', motionMode: 'system', notificationsEnabled: false, habitReminderHour: 8 },
            p_base_version: firstVersion,
            p_key: uuid(),
        });
        expect(applied.error).toBeNull();
        expect((applied.data as { version: number }).version).toBeGreaterThan(firstVersion);

        const tooLarge = await user.client.rpc('upsert_user_settings', {
            p_settings: { padding: 'x'.repeat(20000) }, p_base_version: null, p_key: uuid(),
        });
        expect(tooLarge.error).not.toBeNull();
    });

    it('1操作1version: 複数テーブルの変更行に同一versionが付与され、(version, id)順で決定的に返る（指摘#8・#9）', async () => {
        // ダミーの複数テーブル操作: 1トランザクションで採番1回、tasks2行+habits1行に同じversionを付与
        const taskIds = [uuid(), uuid()].sort();
        const habitId = uuid();
        await pg.query('begin');
        const { rows } = await pg.query('select next_sync_version($1) as v', [user.id]);
        const v = Number(rows[0].v);
        await pg.query(
            'insert into tasks (id, user_id, name, version) values ($1, $4, $3, $5), ($2, $4, $3, $5)',
            [taskIds[0], taskIds[1], 'multi-table-op', user.id, v],
        );
        await pg.query(
            'insert into habits (id, user_id, name, version) values ($1, $2, $3, $4)',
            [habitId, user.id, 'multi-table-habit', v],
        );
        await pg.query('commit');

        const batch = await pull(v - 1, 1);
        expect(batch.tasks.map((t) => t.id)).toEqual(taskIds); // 同一version内はid昇順で決定的
        expect(batch.tasks.every((t) => Number(t.version) === v)).toBe(true);
        expect(batch.habits).toHaveLength(1);
        expect(Number(batch.habits[0].version)).toBe(v); // 全テーブルに同一version
    });

    it('1操作1versionガード: 同一トランザクションで2回採番すると例外になる（指摘#9）', async () => {
        await pg.query('begin');
        await pg.query('select next_sync_version($1)', [user.id]);
        await expect(pg.query('select next_sync_version($1)', [user.id]))
            .rejects.toThrow(/called twice in one transaction/);
        await pg.query('rollback');

        // 別トランザクションなら再び採番できる
        const { rows } = await pg.query('select next_sync_version($1) as v', [user.id]);
        expect(Number(rows[0].v)).toBeGreaterThan(0);
    });

    it('handle_new_userがuser_settings行も生成し、pull_sync_batchで取得できる', async () => {
        const { rows } = await pg.query('select count(*) from user_settings where user_id=$1', [user.id]);
        expect(rows[0].count).toBe('1');
    });

    it('複合FK: 他人の親タスクに自分のサブタスクはぶら下げられない', async () => {
        const other = await createUser(`schema-other-${Date.now()}@example.com`);
        const parentTask = uuid();
        const up = await other.client.rpc('upsert_task', { p_id: parentTask, p_name: '他人の親', p_key: uuid() });
        expect(up.error).toBeNull();

        // superuser直接でも複合FKが拒否する（防御はRLSではなくスキーマ制約）
        await expect(pg.query(
            'insert into subtasks (task_id, user_id, name, version) values ($1, $2, $3, 999)',
            [parentTask, user.id, '越境サブタスク'],
        )).rejects.toThrow(/foreign key constraint/);
    });

    it('sync_versionsのRealtime通知1本で全テーブルの変更を検知できる（ADR-008）', async () => {
        let done = false;
        const notified = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('realtime timeout')), 25000);
            const channel = user.client
                .channel('schema-sync-versions')
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_versions', filter: `user_id=eq.${user.id}` }, () => {
                    done = true;
                    clearTimeout(timer);
                    void user.client.removeChannel(channel);
                    resolve();
                })
                .subscribe((status) => {
                    if (status !== 'SUBSCRIBED') return;
                    void (async () => {
                        for (let attempt = 0; attempt < 5 && !done; attempt++) {
                            // tasksへの書き込みだが、通知はsync_versionsのUPDATEとして届く
                            await user.client.rpc('upsert_task', { p_id: uuid(), p_name: 'sync-versions-notify', p_key: uuid() });
                            await new Promise((r) => setTimeout(r, 3000));
                        }
                    })();
                });
        });

        await expect(notified).resolves.toBeUndefined();
    }, 30000);
});
