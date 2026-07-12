// @vitest-environment node
/**
 * #507 core-vs-Edge Functionパリティテスト。
 *
 * `@life-quest/core` の単体テストが検証している算出ルール（XP額など）を、
 * 実際のEdge Function呼び出し経由でも同じ入力に対し同じ出力になることを確認する。
 * Edge Function側は複製した計算ロジックを持たず、常にcoreの定数・純関数を
 * importして使う設計（#502 ADR-002案B）なので、ここではその配線自体が
 * 壊れていないこと（importのすり替え・値のハードコード混入がないこと）を担保する。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { XP_CONFIG } from '@life-quest/core/progression';
import { EQUIPMENT_POOL, SELL_XP_BY_RARITY } from '@life-quest/core/rewards';
import type { Priority } from '@life-quest/core/tasks';

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

describe.skipIf(!enabled)('#507 core-vs-Edge Functionパリティ', () => {
    let user: Awaited<ReturnType<typeof createUser>>;
    let pg: PgClient;

    const callFn = (name: string, body: unknown) =>
        fetch(`${FUNCTIONS_URL}/${name}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

    beforeAll(async () => {
        pg = new PgClient({ connectionString: DB_URL });
        await pg.connect();
        user = await createUser(`core-parity-${Date.now()}@example.com`);
    }, 30000);

    afterAll(async () => {
        await pg?.end();
    });

    it.each(['low', 'medium', 'high'] as Priority[])(
        'complete_task: 優先度%sのXP付与額がcore XP_CONFIG.REWARD_BY_PRIORITYと一致する',
        async (priority) => {
            const { rows } = await pg.query('select next_sync_version($1) as v', [user.id]);
            const taskId = uuid();
            await pg.query(
                'insert into tasks (id, user_id, name, priority, version) values ($1, $2, $3, $4, $5)',
                [taskId, user.id, `パリティ検証タスク-${priority}`, priority, rows[0].v],
            );

            const before = await pg.query('select total_xp from characters where user_id=$1', [user.id]);
            const res = await callFn('complete_task', { taskId, idempotencyKey: uuid() });
            expect(res.status).toBe(200);
            const after = await pg.query('select total_xp from characters where user_id=$1', [user.id]);

            const grantedXp = Number(after.rows[0].total_xp) - Number(before.rows[0].total_xp);
            expect(grantedXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY[priority]);
        },
    );

    it('sell_item: 売却XPがcore SELL_XP_BY_RARITYと一致する（既知テンプレート全種で確認）', async () => {
        // レアリティが異なる代表テンプレートを1つずつ選ぶ
        const seen = new Set<string>();
        const samples = EQUIPMENT_POOL.filter((template) => {
            if (seen.has(template.rarity)) return false;
            seen.add(template.rarity);
            return true;
        });
        expect(samples.length).toBeGreaterThan(0);

        for (const template of samples) {
            const { rows } = await pg.query('select next_sync_version($1) as v', [user.id]);
            const itemId = uuid();
            await pg.query(
                'insert into inventory_items (id, user_id, template_id, version) values ($1, $2, $3, $4)',
                [itemId, user.id, template.id, rows[0].v],
            );

            const before = await pg.query('select total_xp from characters where user_id=$1', [user.id]);
            const res = await callFn('sell_item', { itemId, idempotencyKey: uuid() });
            expect(res.status).toBe(200);
            const after = await pg.query('select total_xp from characters where user_id=$1', [user.id]);

            const grantedXp = Number(after.rows[0].total_xp) - Number(before.rows[0].total_xp);
            expect(grantedXp).toBe(SELL_XP_BY_RARITY[template.rarity]);
        }
    });
});
