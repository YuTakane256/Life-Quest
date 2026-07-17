// @vitest-environment node
/**
 * #507 RLS侵入テスト（全テーブル網羅）とservice roleバイパス前提の所有者検証。
 *
 * 「RLSが効いているから安全」という誤った前提でテストが緑になっていないことを、
 * 通常経路（RLS）とservice role直接呼び出し（RLSバイパス、Edge Functionの実行環境を模す）の
 * 両方で担保する。既存の spike.test.ts / two-client-sync.test.ts / game.test.ts が
 * tasks・subtasksを中心に検証済みのため、本ファイルは残りのテーブル・Edge Functionを網羅する。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const DB_URL = process.env.SUPABASE_DB_URL;
const API_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;
const enabled = Boolean(DB_URL && API_URL && ANON_KEY && SERVICE_KEY && FUNCTIONS_URL);

const uuid = () => crypto.randomUUID();

async function createUser(email: string) {
    const admin = createClient(API_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.createUser({
        email, password: 'password-123', email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const client = createClient(API_URL!, ANON_KEY!, { auth: { persistSession: false } });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: 'password-123' });
    if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
    const { data: session } = await client.auth.getSession();
    return { id: data.user.id, client, token: session.session!.access_token };
}

/** RLS select policyがある全テーブル。profiles/sync_versionsはhandle_new_userで自動生成済み。 */
const RLS_TABLES = [
    'profiles', 'tasks', 'subtasks', 'habits', 'habit_logs', 'rest_days',
    'user_settings', 'stats_daily', 'sync_versions', 'reward_transactions',
    'characters', 'inventory_items', 'chests', 'battle_attempts',
] as const;

describe.skipIf(!enabled)('#507 RLS侵入テスト（全テーブル網羅）', () => {
    let user: Awaited<ReturnType<typeof createUser>>;
    let attacker: Awaited<ReturnType<typeof createUser>>;
    let pg: PgClient;

    beforeAll(async () => {
        pg = new PgClient({ connectionString: DB_URL });
        await pg.connect();
        const suffix = Date.now();
        user = await createUser(`rls-owner-${suffix}@example.com`);
        attacker = await createUser(`rls-attacker-${suffix}@example.com`);
        // 各テーブルへの参照行を用意する（profiles/characters/sync_versionsはhandle_new_userで既存）
        const version = async () => Number((await pg.query('select next_sync_version($1) as v', [user.id])).rows[0].v);
        await pg.query(
            `insert into tasks (id, user_id, name, version) values ($1, $2, '所有者タスク', $3)`,
            [uuid(), user.id, await version()],
        );
        await pg.query(
            `insert into habits (id, user_id, name, created_at, version) values ($1, $2, '所有者習慣', '2026-07-01', $3)`,
            [uuid(), user.id, await version()],
        );
        await pg.query(
            `insert into chests (id, user_id, chest_type, label, version) values ($1, $2, 'wood', '所有者宝箱', $3)`,
            [uuid(), user.id, await version()],
        );
        await pg.query(
            `insert into inventory_items (id, user_id, template_id, version) values ($1, $2, 'wooden_sword', $3)`,
            [uuid(), user.id, await version()],
        );
    }, 30000);

    afterAll(async () => {
        await pg?.end();
    });

    it.each(RLS_TABLES)('%s: 他ユーザーの行はSELECTで空、直接write（INSERT/UPDATE/DELETE）は全てrevoke済み', async (table) => {
        const { data: crossRead, error: readError } = await attacker.client.from(table).select('*').eq('user_id', user.id);
        expect(readError).toBeNull();
        expect(crossRead).toEqual([]);

        const insertResult = await attacker.client.from(table).insert({ user_id: attacker.id } as never);
        expect(insertResult.error).not.toBeNull();

        const updateResult = await attacker.client.from(table).update({ user_id: attacker.id } as never).eq('user_id', attacker.id);
        expect(updateResult.error).not.toBeNull();

        const deleteResult = await attacker.client.from(table).delete().eq('user_id', attacker.id);
        expect(deleteResult.error).not.toBeNull();
    });

    it('idempotency_keys: SELECTも含め全操作がrevokeされている（内部台帳）', async () => {
        const { data, error } = await user.client.from('idempotency_keys').select('*');
        expect(error).not.toBeNull();
        expect(data).toBeNull();
    });
});

describe.skipIf(!enabled)('#507 Edge Function越境アクセス拒否（全リソース系Function網羅）', () => {
    let user: Awaited<ReturnType<typeof createUser>>;
    let attacker: Awaited<ReturnType<typeof createUser>>;
    let pg: PgClient;
    let ownerTaskId: string;
    let ownerChestId: string;
    let ownerItemId: string;
    let ownerAttemptId: string;

    const callFn = (name: string, body: unknown, token: string) =>
        fetch(`${FUNCTIONS_URL}/${name}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

    beforeAll(async () => {
        pg = new PgClient({ connectionString: DB_URL });
        await pg.connect();
        const suffix = Date.now();
        user = await createUser(`edgefn-owner-${suffix}@example.com`);
        attacker = await createUser(`edgefn-attacker-${suffix}@example.com`);

        const version = async () => Number((await pg.query('select next_sync_version($1) as v', [user.id])).rows[0].v);

        ownerTaskId = uuid();
        await pg.query(
            `insert into tasks (id, user_id, name, version) values ($1, $2, '越境対象タスク', $3)`,
            [ownerTaskId, user.id, await version()],
        );

        ownerChestId = uuid();
        await pg.query(
            `insert into chests (id, user_id, chest_type, label, version) values ($1, $2, 'wood', '越境対象宝箱', $3)`,
            [ownerChestId, user.id, await version()],
        );

        ownerItemId = uuid();
        await pg.query(
            `insert into inventory_items (id, user_id, template_id, version) values ($1, $2, 'wooden_sword', $3)`,
            [ownerItemId, user.id, await version()],
        );

        ownerAttemptId = uuid();
        await pg.query(
            `insert into battle_attempts (id, user_id, stage, status, enemy_snapshot, player_snapshot, version)
             values ($1, $2, 1, 'in_progress', $3, $4, $5)`,
            [
                ownerAttemptId, user.id,
                JSON.stringify({ stage: 1, name: 'スライム', maxHp: 10, attack: 1, defense: 1, xpReward: 5 }),
                JSON.stringify({ name: '相手', level: 1, attack: 5, defense: 5, maxHp: 30 }),
                await version(),
            ],
        );
    }, 30000);

    afterAll(async () => {
        await pg?.end();
    });

    it('complete_task: 他人のtaskIdは404', async () => {
        const res = await callFn('complete_task', { taskId: ownerTaskId, idempotencyKey: uuid() }, attacker.token);
        expect(res.status).toBe(404);
    });

    it('open_chest: 他人のchestIdは404', async () => {
        const res = await callFn('open_chest', { chestId: ownerChestId, idempotencyKey: uuid() }, attacker.token);
        expect(res.status).toBe(404);
    });

    it('sell_item: 他人のitemIdは404', async () => {
        const res = await callFn('sell_item', { itemId: ownerItemId, idempotencyKey: uuid() }, attacker.token);
        expect(res.status).toBe(404);
    });

    it('resolve_battle_attempt: 他人のbattleAttemptIdは404', async () => {
        const res = await callFn(
            'resolve_battle_attempt',
            { battleAttemptId: ownerAttemptId, idempotencyKey: uuid(), actions: [{ type: 'attack' }] },
            attacker.token,
        );
        expect(res.status).toBe(404);
    });

    it('リクエストボディに他人のuser_idを混入させても無視され、JWT由来のuser_idのみが使われる（越境できない）', async () => {
        const res = await callFn(
            'complete_task',
            { taskId: ownerTaskId, idempotencyKey: uuid(), userId: user.id, user_id: user.id },
            attacker.token,
        );
        // ボディのuser_id/userIdは読まれず、JWT(attacker)のuser_idで所有者検証されるため404のまま
        expect(res.status).toBe(404);
    });
});

describe.skipIf(!enabled)('#507 service roleバイパス前提の所有者検証（レビュー指摘#6）', () => {
    let user: Awaited<ReturnType<typeof createUser>>;
    let attacker: Awaited<ReturnType<typeof createUser>>;
    let pg: PgClient;
    let service: SupabaseClient;
    let ownerTaskId: string;
    let ownerItemId: string;

    beforeAll(async () => {
        pg = new PgClient({ connectionString: DB_URL });
        await pg.connect();
        service = createClient(API_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
        const suffix = Date.now();
        user = await createUser(`bypass-owner-${suffix}@example.com`);
        attacker = await createUser(`bypass-attacker-${suffix}@example.com`);

        const version = async () => Number((await pg.query('select next_sync_version($1) as v', [user.id])).rows[0].v);
        ownerTaskId = uuid();
        await pg.query(
            `insert into tasks (id, user_id, name, version) values ($1, $2, 'バイパス検証対象タスク', $3)`,
            [ownerTaskId, user.id, await version()],
        );
        ownerItemId = uuid();
        await pg.query(
            `insert into inventory_items (id, user_id, template_id, version) values ($1, $2, 'wooden_sword', $3)`,
            [ownerItemId, user.id, await version()],
        );
    }, 30000);

    afterAll(async () => {
        await pg?.end();
    });

    it('service role（RLS丸ごとバイパス）で complete_task_apply を攻撃者user_id×被害者task_idで呼んでも明示検証で拒否される', async () => {
        // service roleはRLSの対象外なので、これが緑になるのはSQL内の
        // `where id = p_task_id and user_id = p_user_id` という明示的な検証のおかげ。
        const { error } = await service.rpc('complete_task_apply', {
            p_user_id: attacker.id,
            p_task_id: ownerTaskId,
            p_xp: 10,
            p_date: '2026-07-01',
            p_chest: null,
            p_next_task: null,
            p_key: uuid(),
        });
        expect(error).not.toBeNull();
        expect(error?.message).toContain('not_found_or_forbidden');

        const { rows } = await pg.query('select completed from tasks where id=$1', [ownerTaskId]);
        expect(rows[0].completed).toBe(false);
    });

    it('service role（RLS丸ごとバイパス）で sell_item_apply を攻撃者user_id×被害者item_idで呼んでも明示検証で拒否される', async () => {
        const { error } = await service.rpc('sell_item_apply', {
            p_user_id: attacker.id,
            p_item_id: ownerItemId,
            p_xp: 5,
            p_key: uuid(),
        });
        expect(error).not.toBeNull();

        const { rows } = await pg.query('select deleted_at from inventory_items where id=$1', [ownerItemId]);
        expect(rows[0].deleted_at).toBeNull();
    });
});
