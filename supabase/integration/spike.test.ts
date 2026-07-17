// @vitest-environment node
/**
 * #511 同期スパイクの統合テスト。ローカルSupabaseスタックに対して実行する。
 *
 * 実行条件: 環境変数 SUPABASE_DB_URL / SUPABASE_URL / SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY が揃っているときのみ（CIのsupabaseジョブと、
 * ローカルで `supabase start` 済みの開発機）。未設定ならスイート全体をskipする。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createCloudPullRunner, type PullBatch } from '@life-quest/core/cloudPull';

const DB_URL = process.env.SUPABASE_DB_URL;
const API_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(DB_URL && API_URL && ANON_KEY && SERVICE_KEY);
// Edge Function検証は `supabase functions serve` が起動しているときのみ
//（例: http://127.0.0.1:55321/functions/v1）
const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;

const uuid = () => crypto.randomUUID();

function anonClient(): SupabaseClient {
    return createClient(API_URL!, ANON_KEY!, { auth: { persistSession: false } });
}

async function createUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
    const admin = createClient(API_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.createUser({
        email,
        password: 'password-123',
        email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const client = anonClient();
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: 'password-123' });
    if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
    return { id: data.user.id, client };
}

describe.skipIf(!enabled)('#511 同期スパイク（ローカルSupabase統合）', () => {
    let userA: { id: string; client: SupabaseClient };
    let userB: { id: string; client: SupabaseClient };
    let pg: PgClient;

    beforeAll(async () => {
        pg = new PgClient({ connectionString: DB_URL });
        await pg.connect();
        userA = await createUser(`spike-a-${Date.now()}@example.com`);
        userB = await createUser(`spike-b-${Date.now()}@example.com`);
    }, 30000);

    afterAll(async () => {
        await pg?.end();
    });

    it('handle_new_userがprofilesとsync_versions行を必ず生成する', async () => {
        const { rows } = await pg.query(
            'select (select count(*) from sync_versions where user_id=$1) as sv, (select count(*) from profiles where user_id=$1) as pr',
            [userA.id],
        );
        expect(rows[0].sv).toBe('1');
        expect(rows[0].pr).toBe('1');
    });

    it('upsert_taskが冪等キーで二重作成を防ぐ', async () => {
        const taskId = uuid();
        const key = uuid();
        const first = await userA.client.rpc('upsert_task', { p_id: taskId, p_name: '冪等テスト', p_key: key });
        expect(first.error).toBeNull();
        const second = await userA.client.rpc('upsert_task', { p_id: uuid(), p_name: '別ID同キー', p_key: key });
        expect(second.error).toBeNull();

        const { rows } = await pg.query('select count(*) from tasks where user_id=$1', [userA.id]);
        expect(rows[0].count).toBe('1'); // 同キーの2回目は副作用なし
    });

    it('RLS: 他ユーザーの行はSELECTできず、直接書き込みはrevokeされている', async () => {
        const { data: crossRead } = await userB.client.from('tasks').select('*').eq('user_id', userA.id);
        expect(crossRead).toEqual([]);

        const direct = await userA.client.from('tasks').insert({
            id: uuid(), user_id: userA.id, name: '直接insert', version: 999,
        });
        expect(direct.error).not.toBeNull(); // permission denied（revoke検証）

        const update = await userA.client.from('tasks').update({ name: 'x' }).eq('user_id', userA.id);
        expect(update.error).not.toBeNull();
    });

    it('同時トランザクション: next_sync_versionの後発は先発のコミットまでブロックされ、採番順=コミット順', async () => {
        const pgA = new PgClient({ connectionString: DB_URL });
        const pgB = new PgClient({ connectionString: DB_URL });
        await pgA.connect();
        await pgB.connect();
        try {
            await pgA.query('begin');
            const a = await pgA.query('select next_sync_version($1) as v', [userA.id]);

            // Bは採番でブロックされるはず。先に完了マーカーを仕込んで順序を観測する。
            const order: string[] = [];
            const bPromise = (async () => {
                await pgB.query('begin');
                const b = await pgB.query('select next_sync_version($1) as v', [userA.id]);
                order.push('b-acquired');
                await pgB.query('commit');
                return Number(b.rows[0].v);
            })();

            await new Promise((resolve) => setTimeout(resolve, 300));
            order.push('a-commits');
            await pgA.query('commit');
            const bVersion = await bPromise;

            expect(order).toEqual(['a-commits', 'b-acquired']); // Bはコミットまで待たされた
            expect(bVersion).toBe(Number(a.rows[0].v) + 1);
        } finally {
            await pgA.end();
            await pgB.end();
        }
    });

    it('pull_sync_batch: 範囲検証・(version,id)順・境界原子性・墓標・カーソル方針', async () => {
        // 範囲検証
        const bad = await userA.client.rpc('pull_sync_batch', { p_after_version: 0, p_max_versions: 0 });
        expect(bad.error?.message).toContain('invalid p_max_versions');
        const bad2 = await userA.client.rpc('pull_sync_batch', { p_after_version: -1, p_max_versions: 10 });
        expect(bad2.error?.message).toContain('invalid p_after_version');

        // データ準備: 3操作（3version）＋うち1件を論理削除
        const ids = [uuid(), uuid(), uuid()];
        for (const id of ids) {
            const { error } = await userA.client.rpc('upsert_task', { p_id: id, p_name: `batch-${id.slice(0, 4)}`, p_key: uuid() });
            expect(error).toBeNull();
        }
        const del = await userA.client.rpc('delete_task', { p_id: ids[0], p_key: uuid() });
        expect(del.error).toBeNull();

        // バッチ上限2で全件消化: 境界がversion単位で切られ、取りこぼしなくカーソルが進む
        const seen = new Map<string, { version: number; deleted: boolean }>();
        let cursor = 0;
        for (let guard = 0; guard < 10; guard++) {
            const { data, error } = await userA.client.rpc('pull_sync_batch', {
                p_after_version: cursor, p_max_versions: 2,
            });
            expect(error).toBeNull();
            const batch = data as { next_cursor: number; has_more: boolean; tasks: { id: string; version: number; deleted_at: string | null }[] };
            // (version, id)順の検証
            const sorted = [...batch.tasks].sort((x, y) => x.version - y.version || x.id.localeCompare(y.id));
            expect(batch.tasks.map((t) => t.id)).toEqual(sorted.map((t) => t.id));
            for (const t of batch.tasks) {
                seen.set(t.id, { version: t.version, deleted: t.deleted_at !== null });
            }
            expect(batch.next_cursor).toBeGreaterThanOrEqual(cursor);
            cursor = batch.next_cursor;
            if (!batch.has_more) break;
        }

        // 全操作が漏れなく回収され、墓標も検出される
        for (const id of ids) expect(seen.has(id)).toBe(true);
        expect(seen.get(ids[0])?.deleted).toBe(true);
    });

    it('2クライアント: デバイスAの作成がデバイスB（同一アカウント）のプルで反映される', async () => {
        // デバイスB: cloudPullランナー（core）で消化
        const applied: string[] = [];
        let cursorStore = 0;
        const runner = createCloudPullRunner({
            fetchBatch: async (after, max) => {
                const { data, error } = await userB.client.rpc('pull_sync_batch', {
                    p_after_version: after, p_max_versions: max,
                });
                if (error) throw new Error(error.message);
                return data as PullBatch;
            },
            applyBatch: (batch) => {
                for (const task of (batch.tasks as { name: string }[] | undefined) ?? []) {
                    applied.push(task.name);
                }
            },
            readCursor: async () => cursorStore,
            writeCursor: async (next) => { cursorStore = next; },
        });

        // デバイスA（Bと同一ユーザーの別セッション）で作成
        const deviceA = anonClient();
        await deviceA.auth.signInWithPassword({
            email: (await userB.client.auth.getUser()).data.user!.email!,
            password: 'password-123',
        });
        const { error } = await deviceA.rpc('upsert_task', { p_id: uuid(), p_name: 'from-device-A', p_key: uuid() });
        expect(error).toBeNull();

        await runner.flush();
        expect(applied).toContain('from-device-A');
        expect(cursorStore).toBeGreaterThan(0);
    });

    it('complete_task_apply: 冪等・ADR-003ゲート・所有者検証・1操作1version', async () => {
        const taskId = uuid();
        await userA.client.rpc('upsert_task', { p_id: taskId, p_name: '完了対象', p_key: uuid() });

        const call = (key: string, uid = userA.id, xp = 10) =>
            pg.query("select complete_task_apply($1,$2,$3,'2026-07-01',null,null,$4) as r", [uid, taskId, xp, key]);

        // 初回: granted=true
        const key1 = uuid();
        const first = await call(key1);
        expect(first.rows[0].r.granted).toBe(true);

        // 同一キー再送: 副作用なし（過去の結果を返す）
        const replay = await call(key1);
        expect(replay.rows[0].r.granted).toBe(true); // キャッシュされた初回結果
        // 別キーで再完了: ADR-003により報酬はgrantedされない
        const second = await call(uuid());
        expect(second.rows[0].r.granted).toBe(false);

        const { rows } = await pg.query(
            "select count(*) from reward_transactions where user_id=$1 and kind='task_complete' and source_id=$2",
            [userA.id, taskId],
        );
        expect(rows[0].count).toBe('1'); // 報酬台帳は生涯1回

        // 所有者検証: 他人のタスクはRLSではなく明示検証で拒否（service role相当の直接呼び出し）
        await expect(call(uuid(), userB.id)).rejects.toThrow(/not_found_or_forbidden/);

        // 1操作1version: 完了操作で更新された行のversionが単一値
        const versions = await pg.query('select distinct version from tasks where id=$1', [taskId]);
        expect(versions.rows).toHaveLength(1);
    });

    it('Realtime通知（通知専用）を受けてプルをトリガできる', async () => {
        let done = false;
        const notified = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('realtime timeout')), 25000);
            const channel = userA.client
                .channel('spike-tasks')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userA.id}` }, () => {
                    done = true;
                    clearTimeout(timer);
                    void userA.client.removeChannel(channel);
                    resolve();
                })
                .subscribe((status) => {
                    // SUBSCRIBED確定後に書き込む。サーバー側のWAL購読確立が
                    // わずかに遅れるレースがあるため、通知が来るまで数秒おきに再書き込みする。
                    if (status !== 'SUBSCRIBED') return;
                    void (async () => {
                        for (let attempt = 0; attempt < 5 && !done; attempt++) {
                            await userA.client.rpc('upsert_task', { p_id: uuid(), p_name: 'realtime-trigger', p_key: uuid() });
                            await new Promise((r) => setTimeout(r, 3000));
                        }
                    })();
                });
        });

        await expect(notified).resolves.toBeUndefined();
    }, 30000);

    describe.skipIf(!FUNCTIONS_URL)('Edge Function complete_task（ADR-002案B / ADR-007）', () => {
        it('coreルールでXP算出し、冪等・生涯1回・JWT由来user_id・所有者検証が機能する', async () => {
            const taskId = uuid();
            await userA.client.rpc('upsert_task', { p_id: taskId, p_name: 'EF完了対象', p_key: uuid() });
            const { data: sessionData } = await userA.client.auth.getSession();
            const token = sessionData.session!.access_token;

            const call = (body: Record<string, unknown>, auth = true) =>
                fetch(`${FUNCTIONS_URL}/complete_task`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify(body),
                });

            // 初回: granted=true（ボディのuser_idは無視される = ADR-007）
            const key = uuid();
            const first = await call({ taskId, idempotencyKey: key, user_id: userB.id });
            expect(first.status).toBe(200);
            const firstBody = await first.json() as { granted: boolean };
            expect(firstBody.granted).toBe(true);

            // 同一キー再送: キャッシュされた初回結果
            const replay = await call({ taskId, idempotencyKey: key });
            expect(((await replay.json()) as { granted: boolean }).granted).toBe(true);

            // 別キー再完了: 報酬は生涯1回（ADR-003）
            const second = await call({ taskId, idempotencyKey: uuid() });
            expect(((await second.json()) as { granted: boolean }).granted).toBe(false);

            // 未認証は401
            const noAuth = await call({ taskId, idempotencyKey: uuid() }, false);
            expect(noAuth.status).toBe(401);

            // 他人（存在しない）タスクは404
            const notOwned = await call({ taskId: uuid(), idempotencyKey: uuid() });
            expect(notOwned.status).toBe(404);

            // 報酬台帳は1行のみ
            const { rows } = await pg.query(
                "select count(*) from reward_transactions where user_id=$1 and kind='task_complete' and source_id=$2",
                [userA.id, taskId],
            );
            expect(rows[0].count).toBe('1');
        }, 20000);
    });
});
