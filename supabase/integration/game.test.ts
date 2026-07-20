// @vitest-environment node
/**
 * #502 サーバー権威RPCの統合テスト。実行条件はspike.test.tsと同じ。
 * Edge Function検証は SUPABASE_FUNCTIONS_URL 設定時のみ（CIのsupabaseジョブで実行）。
 *
 * 受け入れ条件（#502）:
 * - 同一キー並行3回のcomplete_taskで報酬1回分のみ
 * - 完了→取消→完了の反復でも報酬は最初の1回分のみ（ADR-003全副作用ゲート）
 * - 同一ステージ複数回勝利で毎回XP加算（ADR-010）
 * - 同一battle_attempt_idの二重resolveは拒否されXP二重付与なし
 * - 虚偽の行動列はサーバー再計算により拒否される
 * - stage <= max_cleared_stage + 1 の進行ロック
 * - 装備中sell拒否・レアリティ混在synthesize拒否
 * - pull_sync_batchがゲームテーブルを返す
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getTodayJst } from '../../packages/core/src/dates.ts';

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

describe.skipIf(!enabled)('#502 サーバー権威RPC（ローカルSupabase統合）', () => {
    let user: Awaited<ReturnType<typeof createUser>>;
    let other: Awaited<ReturnType<typeof createUser>>;
    let pg: PgClient;

    const callFn = (name: string, body: unknown, token = user.token) =>
        fetch(`${FUNCTIONS_URL}/${name}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

    const getCharacter = async () => {
        const { rows } = await pg.query(
            'select total_xp, gacha_count, battle_unlocked, max_cleared_stage from characters where user_id=$1',
            [user.id],
        );
        return rows[0] as { total_xp: string; gacha_count: string; battle_unlocked: boolean; max_cleared_stage: number };
    };

    const createTask = async (name: string) => {
        const id = uuid();
        const { error } = await user.client.rpc('upsert_task', { p_id: id, p_name: name, p_key: uuid() });
        if (error) throw new Error(error.message);
        return id;
    };

    /** superuserとして1操作1versionの規約どおり複数行を直接挿入するテストヘルパー */
    const insertWithVersion = async (fn: (version: number) => Promise<void>) => {
        await pg.query('begin');
        const { rows } = await pg.query('select next_sync_version($1) as v', [user.id]);
        await fn(Number(rows[0].v));
        await pg.query('commit');
    };

    beforeAll(async () => {
        pg = new PgClient({ connectionString: DB_URL });
        await pg.connect();
        user = await createUser(`game-${Date.now()}@example.com`);
        other = await createUser(`game-other-${Date.now()}@example.com`);
    }, 30000);

    afterAll(async () => {
        await pg?.end();
    });

    it('handle_new_userがcharacters行を生成し、pull_sync_batchがゲームテーブルのキーを返す', async () => {
        const character = await getCharacter();
        expect(character).toBeDefined();
        expect(character.total_xp).toBe('0');

        const { data, error } = await user.client.rpc('pull_sync_batch', { p_after_version: 0, p_max_versions: 100 });
        expect(error).toBeNull();
        const batch = data as Record<string, unknown>;
        for (const key of ['characters', 'inventory_items', 'chests', 'battle_attempts']) {
            expect(Array.isArray(batch[key]), key).toBe(true);
        }
    });

    it('update_character_profile: name/avatarを更新し、base_version不一致はconflictを返す', async () => {
        const first = await user.client.rpc('update_character_profile', {
            p_name: 'テスト勇者', p_avatar: 'male', p_base_version: null, p_key: uuid(),
        });
        expect(first.error).toBeNull();
        const firstVersion = (first.data as { version: number }).version;

        const { rows } = await pg.query('select name, avatar, version from characters where user_id=$1', [user.id]);
        expect(rows[0].name).toBe('テスト勇者');
        expect(rows[0].avatar).toBe('male');
        expect(Number(rows[0].version)).toBe(firstVersion);

        const conflict = await user.client.rpc('update_character_profile', {
            p_name: '古い端末からの上書き', p_avatar: 'female', p_base_version: firstVersion - 1, p_key: uuid(),
        });
        expect(conflict.error).toBeNull();
        const conflictBody = conflict.data as { conflict: boolean; current: { name: string } };
        expect(conflictBody.conflict).toBe(true);
        expect(conflictBody.current.name).toBe('テスト勇者'); // 変更されていない

        // 同一キー再送は副作用なし（同じversionが返る）
        const replayKey = uuid();
        const applied = await user.client.rpc('update_character_profile', {
            p_name: '再送テスト', p_avatar: 'female', p_base_version: firstVersion, p_key: replayKey,
        });
        expect(applied.error).toBeNull();
        const replay = await user.client.rpc('update_character_profile', {
            p_name: '再送で変わってはいけない', p_avatar: 'male', p_base_version: firstVersion, p_key: replayKey,
        });
        expect(replay.error).toBeNull();
        expect(replay.data).toEqual(applied.data);
        const { rows: afterReplay } = await pg.query('select name from characters where user_id=$1', [user.id]);
        expect(afterReplay[0].name).toBe('再送テスト');
    });

    it('complete_task: 同一キー並行3回でXP・gacha_countが1回分のみ（ADR-004）', async () => {
        const taskId = await createTask('並行完了');
        const key = uuid();
        const responses = await Promise.all([
            callFn('complete_task', { taskId, idempotencyKey: key }),
            callFn('complete_task', { taskId, idempotencyKey: key }),
            callFn('complete_task', { taskId, idempotencyKey: key }),
        ]);
        for (const res of responses) expect(res.status).toBe(200);

        const character = await getCharacter();
        expect(character.total_xp).toBe('20'); // medium = 20 XP、1回分のみ
        expect(character.gacha_count).toBe('1');
    });

    it('完了→取消→完了を3回繰り返しても報酬は最初の1回分のみ（ADR-003全副作用ゲート）', async () => {
        const taskId = await createTask('取消再完了');
        const first = await callFn('complete_task', { taskId, idempotencyKey: uuid() });
        expect(((await first.json()) as { granted: boolean }).granted).toBe(true);
        const before = await getCharacter();

        for (let i = 0; i < 3; i++) {
            const un = await user.client.rpc('uncomplete_task', { p_id: taskId, p_key: uuid() });
            expect(un.error).toBeNull();
            const re = await callFn('complete_task', { taskId, idempotencyKey: uuid() });
            expect(re.status).toBe(200);
            expect(((await re.json()) as { granted: boolean }).granted).toBe(false);
        }

        const after = await getCharacter();
        expect(after.total_xp).toBe(before.total_xp);
        expect(after.gacha_count).toBe(before.gacha_count);
        const { rows } = await pg.query(
            "select count(*) from reward_transactions where user_id=$1 and kind='task_complete' and source_id=$2",
            [user.id, taskId],
        );
        expect(rows[0].count).toBe('1');
    });

    it('所有者検証: 他人のタスクはRLSではなく明示検証で404', async () => {
        const otherTask = uuid();
        await other.client.rpc('upsert_task', { p_id: otherTask, p_name: '他人のタスク', p_key: uuid() });
        const res = await callFn('complete_task', { taskId: otherTask, idempotencyKey: uuid() });
        expect(res.status).toBe(404);
    });

    it('gacha_count=5到達でスターター青宝箱が生成され、開封でバトルが解放される', async () => {
        // ここまでで gacha_count=2（並行1 + 取消再完了1）。あと3回完了して5にする
        for (let i = 0; i < 3; i++) {
            const taskId = await createTask(`milestone-${i}`);
            const res = await callFn('complete_task', { taskId, idempotencyKey: uuid() });
            expect(((await res.json()) as { granted: boolean }).granted).toBe(true);
        }
        const character = await getCharacter();
        expect(character.gacha_count).toBe('5');

        const { rows: chests } = await pg.query(
            "select id, chest_type, is_starter_character, opened from chests where user_id=$1",
            [user.id],
        );
        expect(chests).toHaveLength(1);
        expect(chests[0].chest_type).toBe('blue');
        expect(chests[0].is_starter_character).toBe(true);

        const open = await callFn('open_chest', { chestId: chests[0].id, idempotencyKey: uuid() });
        expect(open.status).toBe(200);
        expect((await getCharacter()).battle_unlocked).toBe(true);

        // blue宝箱は装備を排出しない（core共有ルール）
        const { rows: items } = await pg.query('select count(*) from inventory_items where user_id=$1', [user.id]);
        expect(items[0].count).toBe('0');

        // 二重開封は409
        const reopen = await callFn('open_chest', { chestId: chests[0].id, idempotencyKey: uuid() });
        expect(reopen.status).toBe(409);
    });

    it('バトル: 同一ステージへの複数回挑戦・勝利でそのたびにXPが加算される（ADR-010）', async () => {
        const winActions = Array.from({ length: 12 }, () => ({ type: 'attack' }));
        const xpBefore = Number((await getCharacter()).total_xp);

        for (let round = 0; round < 2; round++) {
            const start = await callFn('start_battle_attempt', { stage: 1, idempotencyKey: uuid() });
            expect(start.status).toBe(200);
            const attempt = (await start.json()) as { battle_attempt_id: string; player_snapshot: { attack: number } };
            expect(attempt.player_snapshot.attack).toBeGreaterThan(0); // サーバーが確定したステータス

            const resolve = await callFn('resolve_battle_attempt', {
                battleAttemptId: attempt.battle_attempt_id,
                actions: winActions,
                idempotencyKey: uuid(),
            });
            expect(resolve.status).toBe(200);
            const body = (await resolve.json()) as { outcome: string; granted: boolean };
            expect(body.outcome).toBe('victory');
            expect(body.granted).toBe(true);
        }

        const character = await getCharacter();
        expect(Number(character.total_xp)).toBe(xpBefore + 5 * 2); // ステージ1のXP5が2回
        expect(character.max_cleared_stage).toBe(1);
    });

    it('同一battle_attempt_idの二重resolveは既存結果を返しXPは二重付与されない（ADR-010）', async () => {
        const winActions = Array.from({ length: 12 }, () => ({ type: 'attack' }));
        const start = await callFn('start_battle_attempt', { stage: 1, idempotencyKey: uuid() });
        const attempt = (await start.json()) as { battle_attempt_id: string };

        const first = await callFn('resolve_battle_attempt', {
            battleAttemptId: attempt.battle_attempt_id, actions: winActions, idempotencyKey: uuid(),
        });
        expect(((await first.json()) as { granted: boolean }).granted).toBe(true);
        const xpAfterFirst = (await getCharacter()).total_xp;

        const second = await callFn('resolve_battle_attempt', {
            battleAttemptId: attempt.battle_attempt_id, actions: winActions, idempotencyKey: uuid(),
        });
        expect(second.status).toBe(200);
        const body = (await second.json()) as { granted: boolean; already_resolved: boolean };
        expect(body.already_resolved).toBe(true);
        expect(body.granted).toBe(false);
        expect((await getCharacter()).total_xp).toBe(xpAfterFirst);
    });

    it('虚偽の行動列はサーバー再計算で拒否される（勝利の自己申告を信用しない）', async () => {
        const start = await callFn('start_battle_attempt', { stage: 1, idempotencyKey: uuid() });
        const attempt = (await start.json()) as { battle_attempt_id: string };

        // 決着に至らない行動列（1回攻撃しただけで「勝った」と主張するのに相当）
        const short = await callFn('resolve_battle_attempt', {
            battleAttemptId: attempt.battle_attempt_id, actions: [{ type: 'attack' }], idempotencyKey: uuid(),
        });
        expect(short.status).toBe(422);

        // クールダウン無視のスキル連打
        const cheat = await callFn('resolve_battle_attempt', {
            battleAttemptId: attempt.battle_attempt_id,
            actions: [
                { type: 'skill', skillId: 'power_strike' },
                { type: 'skill', skillId: 'power_strike' },
            ],
            idempotencyKey: uuid(),
        });
        expect(cheat.status).toBe(422);

        // attemptはin_progressのまま。正しい行動列なら決着できる
        const winActions = Array.from({ length: 12 }, () => ({ type: 'attack' }));
        const proper = await callFn('resolve_battle_attempt', {
            battleAttemptId: attempt.battle_attempt_id, actions: winActions, idempotencyKey: uuid(),
        });
        expect(proper.status).toBe(200);
        expect(((await proper.json()) as { outcome: string }).outcome).toBe('victory');
    });

    it('進行ロック: max_cleared_stage+1 を超えるステージへの挑戦は拒否される', async () => {
        const res = await callFn('start_battle_attempt', { stage: 5, idempotencyKey: uuid() });
        expect(res.status).toBe(409);
        expect(((await res.json()) as { error: string }).error).toContain('stage_locked');
    });

    it('装備中アイテムのsellは拒否、非装備は売却されXP加算', async () => {
        const equippedId = uuid();
        const sellableId = uuid();
        await insertWithVersion(async (v) => {
            await pg.query(
                `insert into inventory_items (id, user_id, template_id, equipped, version)
                 values ($1, $3, 'wooden_sword', true, $4), ($2, $3, 'leather_armor', false, $4)`,
                [equippedId, sellableId, user.id, v],
            );
        });

        const denied = await callFn('sell_item', { itemId: equippedId, idempotencyKey: uuid() });
        expect(denied.status).toBe(409);

        const xpBefore = Number((await getCharacter()).total_xp);
        const sold = await callFn('sell_item', { itemId: sellableId, idempotencyKey: uuid() });
        expect(sold.status).toBe(200);
        expect(Number((await getCharacter()).total_xp)).toBeGreaterThan(xpBefore);
        const { rows } = await pg.query('select deleted_at from inventory_items where id=$1', [sellableId]);
        expect(rows[0].deleted_at).not.toBeNull();
    });

    it('synthesize: 同一レアリティ3点で上位1点が生成され、レアリティ混在は拒否される', async () => {
        const commons = [uuid(), uuid(), uuid()];
        const uncommon = uuid();
        await insertWithVersion(async (v) => {
            for (const id of commons) {
                await pg.query(
                    `insert into inventory_items (id, user_id, template_id, version) values ($1, $2, 'wooden_sword', $3)`,
                    [id, user.id, v],
                );
            }
            await pg.query(
                `insert into inventory_items (id, user_id, template_id, version) values ($1, $2, 'iron_sword', $3)`,
                [uncommon, user.id, v],
            );
        });

        // 混在（2 common + 1 uncommon）は拒否
        const mixed = await callFn('synthesize_items', {
            itemIds: [...commons.slice(0, 2), uncommon], idempotencyKey: uuid(),
        });
        expect(mixed.status).toBe(409);

        // 同一レアリティ3点（core SYNTHESIS_CONFIG.REQUIRED_COUNT）は成功し、
        // 素材が墓標化され上位レアリティの結果1点が生まれる
        const ok = await callFn('synthesize_items', { itemIds: commons, idempotencyKey: uuid() });
        expect(ok.status).toBe(200);
        const body = (await ok.json()) as { result_id: string; template_id: string };
        const { rows } = await pg.query(
            'select template_id from inventory_items where id=$1 and deleted_at is null', [body.result_id]);
        expect(rows).toHaveLength(1);
        expect(['iron_sword', 'chain_mail', 'silver_ring']).toContain(rows[0].template_id);
        // レスポンスのtemplate_idが実際に挿入された装備と一致する（DB関数のv_result由来）
        expect(body.template_id).toBe(rows[0].template_id);
        const { rows: gone } = await pg.query(
            'select count(*) from inventory_items where id = any($1) and deleted_at is null', [commons]);
        expect(gone[0].count).toBe('0');
    });

    it('冪等キー再送: open_chest_apply/synthesize_items_applyは同一キーなら同一のtemplate_idを返す（DB関数直接呼び出し）', async () => {
        // EF層はchest.opened/inventory在庫を事前チェックしてから apply を呼ぶため、
        // HTTP経由で「成功後に同じキーで送り直す」場合はEF層の事前チェックで拒否され
        // DB関数のreserve_idempotency_keyまで到達しない（EFの事前チェックはタイミング
        // 依存でHTTPレベルの同時実行テストはflakyになる）。DB関数が保証する冪等性
        // （reserve_idempotency_keyが同一キーの2回目呼び出しで最初のv_resultを
        // そのまま返す）自体はDB関数を直接2回呼び出すことで決定的に検証できる。
        const chestId = uuid();
        const chestItemId = uuid();
        await insertWithVersion(async (v) => {
            await pg.query(
                `insert into chests (id, user_id, chest_type, label, version) values ($1, $2, 'wood', '木の宝箱', $3)`,
                [chestId, user.id, v],
            );
        });
        const chestKey = uuid();
        const chestItem = JSON.stringify({ id: chestItemId, template_id: 'iron_sword' });
        const firstChest = await pg.query(
            'select public.open_chest_apply($1, $2, $3::jsonb, $4) as result',
            [user.id, chestId, chestItem, chestKey],
        );
        const replayChest = await pg.query(
            'select public.open_chest_apply($1, $2, $3::jsonb, $4) as result',
            [user.id, chestId, chestItem, chestKey],
        );
        expect(replayChest.rows[0].result).toEqual(firstChest.rows[0].result);
        expect(firstChest.rows[0].result.template_id).toBe('iron_sword');

        const ingredients = [uuid(), uuid(), uuid()];
        const resultItemId = uuid();
        await insertWithVersion(async (v) => {
            for (const id of ingredients) {
                await pg.query(
                    `insert into inventory_items (id, user_id, template_id, version) values ($1, $2, 'wooden_ring', $3)`,
                    [id, user.id, v],
                );
            }
        });
        const synthKey = uuid();
        const resultItem = JSON.stringify({ id: resultItemId, template_id: 'chain_mail' });
        const firstSynth = await pg.query(
            'select public.synthesize_items_apply($1, $2::uuid[], $3::jsonb, $4) as result',
            [user.id, ingredients, resultItem, synthKey],
        );
        const replaySynth = await pg.query(
            'select public.synthesize_items_apply($1, $2::uuid[], $3::jsonb, $4) as result',
            [user.id, ingredients, resultItem, synthKey],
        );
        expect(replaySynth.rows[0].result).toEqual(firstSynth.rows[0].result);
        expect(firstSynth.rows[0].result.template_id).toBe('chain_mail');
    });

    it('complete_subtask: 半分XP・生涯1回、全サブタスク完了で親が自動完了し親報酬も連鎖する', async () => {
        const taskId = await createTask('サブタスク親');
        const sub1 = uuid();
        const sub2 = uuid();
        await insertWithVersion(async (v) => {
            await pg.query(
                'insert into subtasks (id, task_id, user_id, name, version) values ($1, $3, $4, $5, $6), ($2, $3, $4, $5, $6)',
                [sub1, sub2, taskId, user.id, '子', v],
            );
        });

        // 1つ目: サブタスク報酬のみ。親はまだ完了しない
        const today = getTodayJst();
        const statsBefore = await pg.query(
            'select task_xp from stats_daily where user_id=$1 and date=$2', [user.id, today],
        );
        const xpBefore = Number((await getCharacter()).total_xp);
        const statsXpBefore = Number(statsBefore.rows[0]?.task_xp ?? 0);
        const first = await callFn('complete_subtask', { subtaskId: sub1, idempotencyKey: uuid() });
        expect(first.status).toBe(200);
        const firstBody = (await first.json()) as { granted: boolean; parent_completed: boolean };
        expect(firstBody.granted).toBe(true);
        expect(firstBody.parent_completed).toBe(false);
        expect(Number((await getCharacter()).total_xp)).toBe(xpBefore + 10); // medium 20 の半分
        const statsAfterFirst = await pg.query(
            'select task_xp from stats_daily where user_id=$1 and date=$2', [user.id, today],
        );
        expect(Number(statsAfterFirst.rows[0].task_xp)).toBe(statsXpBefore + 10); // stats_dailyへも継続反映

        // 2つ目: 全サブタスク完了 → 親が自動完了し、親報酬（+20）も同一トランザクションで連鎖
        const second = await callFn('complete_subtask', { subtaskId: sub2, idempotencyKey: uuid() });
        const secondBody = (await second.json()) as { granted: boolean; parent_completed: boolean; parent_granted: boolean };
        expect(secondBody.granted).toBe(true);
        expect(secondBody.parent_completed).toBe(true);
        expect(secondBody.parent_granted).toBe(true);
        expect(Number((await getCharacter()).total_xp)).toBe(xpBefore + 10 + 10 + 20);
        const { rows: parent } = await pg.query('select completed from tasks where id=$1', [taskId]);
        expect(parent[0].completed).toBe(true);
        // サブタスク分（+10）と親分（+20）が同一日へ両方加算される
        const statsAfterSecond = await pg.query(
            'select task_xp from stats_daily where user_id=$1 and date=$2', [user.id, today],
        );
        expect(Number(statsAfterSecond.rows[0].task_xp)).toBe(statsXpBefore + 10 + 10 + 20);

        // 再送は生涯1回ゲートで報酬なし
        const again = await callFn('complete_subtask', { subtaskId: sub1, idempotencyKey: uuid() });
        const againBody = (await again.json()) as { granted: boolean; parent_granted: boolean };
        expect(againBody.granted).toBe(false);
        expect(againBody.parent_granted).toBe(false);
    });

    it('claim_habit_bonus: 未達成は拒否、全達成は日付単位で生涯1回付与', async () => {
        const date = '2026-07-05';
        // 習慣なし → 拒否（0件は全達成とみなさない、core共有ルール）
        const empty = await callFn('claim_habit_bonus', { date, idempotencyKey: uuid() });
        expect(empty.status).toBe(409);

        const habitId = uuid();
        await insertWithVersion(async (v) => {
            await pg.query(
                `insert into habits (id, user_id, name, created_at, version) values ($1, $2, '習慣A', '2026-07-01', $3)`,
                [habitId, user.id, v],
            );
        });
        // 未完了 → 拒否
        const incomplete = await callFn('claim_habit_bonus', { date, idempotencyKey: uuid() });
        expect(incomplete.status).toBe(409);

        await insertWithVersion(async (v) => {
            await pg.query(
                'insert into habit_logs (habit_id, user_id, date, completed, version) values ($1, $2, $3, true, $4)',
                [habitId, user.id, date, v],
            );
        });
        const xpBefore = Number((await getCharacter()).total_xp);
        const granted = await callFn('claim_habit_bonus', { date, idempotencyKey: uuid() });
        expect(granted.status).toBe(200);
        expect(((await granted.json()) as { granted: boolean }).granted).toBe(true);
        expect(Number((await getCharacter()).total_xp)).toBe(xpBefore + 15);

        const twice = await callFn('claim_habit_bonus', { date, idempotencyKey: uuid() });
        expect(((await twice.json()) as { granted: boolean }).granted).toBe(false);

        const { rows } = await pg.query(
            'select all_habits_complete from stats_daily where user_id=$1 and date=$2', [user.id, date]);
        expect(rows[0].all_habits_complete).toBe(true);
    });

    it('繰り返しタスク: 完了時に次回分が生成され、二重完了でも増殖しない', async () => {
        const taskId = uuid();
        await user.client.rpc('upsert_task', { p_id: taskId, p_name: '毎日の習慣タスク', p_key: uuid() });
        await insertWithVersion(async (v) => {
            await pg.query(
                `update tasks set recurrence='daily', due_date='2026-07-05', version=$2 where id=$1`,
                [taskId, v],
            );
        });

        const res = await callFn('complete_task', { taskId, idempotencyKey: uuid() });
        expect(((await res.json()) as { granted: boolean }).granted).toBe(true);

        const { rows } = await pg.query(
            `select due_date::text from tasks where user_id=$1 and name='毎日の習慣タスク' and completed=false and deleted_at is null`,
            [user.id],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].due_date).toBe('2026-07-06'); // 1日進んだ次回分

        // 取消→再完了しても（報酬なし）、次回分は重複生成されない
        await user.client.rpc('uncomplete_task', { p_id: taskId, p_key: uuid() });
        const re = await callFn('complete_task', { taskId, idempotencyKey: uuid() });
        expect(((await re.json()) as { granted: boolean }).granted).toBe(false);
        const { rows: after } = await pg.query(
            `select count(*) from tasks where user_id=$1 and name='毎日の習慣タスク' and completed=false and deleted_at is null`,
            [user.id],
        );
        expect(after[0].count).toBe('1');
    });

    it('upsert_habit/set_habit_log/set_rest_day/delete_habit: 冪等・所有者検証・stats_daily.habit_count継続更新', async () => {
        const habitId = uuid();
        const upsertRes = await user.client.rpc('upsert_habit', {
            p_id: habitId, p_name: '朝の散歩', p_category_id: 'health', p_key: uuid(),
        });
        expect(upsertRes.error).toBeNull();

        // 同一キー再送は副作用なし（同じ習慣が重複作成されない）
        const replayKey = uuid();
        await user.client.rpc('upsert_habit', { p_id: uuid(), p_name: '別ID同キー', p_key: replayKey });
        await user.client.rpc('upsert_habit', { p_id: uuid(), p_name: '別ID同キー2', p_key: replayKey });
        const { rows: habitCount } = await pg.query(
            "select count(*) from habits where user_id=$1 and name like '別ID%'", [user.id],
        );
        expect(habitCount[0].count).toBe('1');

        // 他人の習慣idを渡してもRLSではなく明示検証で拒否される（所有権はauth.uid()経由）
        const otherHabitId = uuid();
        await other.client.rpc('upsert_habit', { p_id: otherHabitId, p_name: '他人の習慣', p_key: uuid() });
        const forbidden = await user.client.rpc('set_habit_log', {
            p_habit_id: otherHabitId, p_date: '2026-07-10', p_completed: true, p_memo: '', p_key: uuid(),
        });
        expect(forbidden.error?.message).toContain('not_found_or_forbidden');

        // set_habit_log: 絶対状態upsert。日付ごとにhabit_countを再集計しgreatestで反映する
        const date = '2026-07-10';
        const log1 = await user.client.rpc('set_habit_log', {
            p_habit_id: habitId, p_date: date, p_completed: true, p_memo: 'メモ', p_key: uuid(),
        });
        expect(log1.error).toBeNull();
        const { rows: statsAfterOn } = await pg.query(
            'select habit_count from stats_daily where user_id=$1 and date=$2', [user.id, date],
        );
        expect(statsAfterOn[0].habit_count).toBe(1);

        // トグルoff→on を繰り返してもhabit_countは真の同時達成数（1）を超えてインフレしない
        await user.client.rpc('set_habit_log', {
            p_habit_id: habitId, p_date: date, p_completed: false, p_memo: 'メモ', p_key: uuid(),
        });
        await user.client.rpc('set_habit_log', {
            p_habit_id: habitId, p_date: date, p_completed: true, p_memo: 'メモ2', p_key: uuid(),
        });
        const { rows: statsAfterToggle } = await pg.query(
            'select habit_count from stats_daily where user_id=$1 and date=$2', [user.id, date],
        );
        expect(statsAfterToggle[0].habit_count).toBe(1);
        const { rows: logRow } = await pg.query(
            'select completed, memo from habit_logs where user_id=$1 and habit_id=$2 and date=$3',
            [user.id, habitId, date],
        );
        expect(logRow[0]).toMatchObject({ completed: true, memo: 'メモ2' });

        // set_rest_day
        const restRes = await user.client.rpc('set_rest_day', { p_date: '2026-07-11', p_active: true, p_key: uuid() });
        expect(restRes.error).toBeNull();
        const { rows: restRow } = await pg.query(
            'select is_rest from rest_days where user_id=$1 and date=$2', [user.id, '2026-07-11'],
        );
        expect(restRow[0].is_rest).toBe(true);

        // delete_habit: habitとhabit_logsが同一トランザクションでカスケード墓標化される
        const delRes = await user.client.rpc('delete_habit', { p_id: habitId, p_key: uuid() });
        expect(delRes.error).toBeNull();
        const { rows: deletedHabit } = await pg.query(
            'select deleted_at from habits where id=$1', [habitId],
        );
        expect(deletedHabit[0].deleted_at).not.toBeNull();
        const { rows: deletedLog } = await pg.query(
            'select deleted_at from habit_logs where user_id=$1 and habit_id=$2 and date=$3',
            [user.id, habitId, date],
        );
        expect(deletedLog[0].deleted_at).not.toBeNull();

        // 削除済み習慣へのset_habit_logは拒否される
        const afterDelete = await user.client.rpc('set_habit_log', {
            p_habit_id: habitId, p_date: date, p_completed: true, p_memo: '', p_key: uuid(),
        });
        expect(afterDelete.error?.message).toContain('not_found_or_forbidden');
    });

    it('並行実行: 同じ宝箱を2本の別キーで同時に開いてもアイテムは1個だけ', async () => {
        const chestId = uuid();
        await insertWithVersion(async (v) => {
            await pg.query(
                `insert into chests (id, user_id, chest_type, label, version) values ($1, $2, 'wood', '木の宝箱', $3)`,
                [chestId, user.id, v],
            );
        });
        const itemsBefore = await pg.query(
            'select count(*) from inventory_items where user_id=$1 and deleted_at is null', [user.id]);

        const [a, b] = await Promise.all([
            callFn('open_chest', { chestId, idempotencyKey: uuid() }),
            callFn('open_chest', { chestId, idempotencyKey: uuid() }),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 409]); // 片方だけ成功

        const itemsAfter = await pg.query(
            'select count(*) from inventory_items where user_id=$1 and deleted_at is null', [user.id]);
        expect(Number(itemsAfter.rows[0].count)).toBe(Number(itemsBefore.rows[0].count) + 1);
    });

    it('並行実行: 同じ素材で合成を同時実行しても結果アイテムは1個だけ', async () => {
        const ingredients = [uuid(), uuid(), uuid()];
        await insertWithVersion(async (v) => {
            for (const id of ingredients) {
                await pg.query(
                    `insert into inventory_items (id, user_id, template_id, version) values ($1, $2, 'wooden_ring', $3)`,
                    [id, user.id, v],
                );
            }
        });
        const itemsBefore = await pg.query(
            'select count(*) from inventory_items where user_id=$1 and deleted_at is null', [user.id]);

        const [a, b] = await Promise.all([
            callFn('synthesize_items', { itemIds: ingredients, idempotencyKey: uuid() }),
            callFn('synthesize_items', { itemIds: ingredients, idempotencyKey: uuid() }),
        ]);
        // 敗者はタイミングにより2通りの正しい拒否になる:
        // DB側の再検証（素材消滅）なら404、EF側のcore検証（読み取りが勝者コミット後）なら409
        const statuses = [a.status, b.status].sort((x, y) => x - y);
        expect(statuses[0]).toBe(200);
        expect([404, 409]).toContain(statuses[1]);

        // 素材3消滅・結果1生成が1回分だけ（複製されない）
        const itemsAfter = await pg.query(
            'select count(*) from inventory_items where user_id=$1 and deleted_at is null', [user.id]);
        expect(Number(itemsAfter.rows[0].count)).toBe(Number(itemsBefore.rows[0].count) - 3 + 1);
    });

    it('並行実行: 同一タスクを2本の別キーで同時完了しても報酬は1回分', async () => {
        const taskId = await createTask('並行別キー完了');
        const xpBefore = Number((await getCharacter()).total_xp);

        const [a, b] = await Promise.all([
            callFn('complete_task', { taskId, idempotencyKey: uuid() }),
            callFn('complete_task', { taskId, idempotencyKey: uuid() }),
        ]);
        const bodies = await Promise.all([a.json(), b.json()]) as { granted: boolean }[];
        expect(bodies.filter((body) => body.granted)).toHaveLength(1);
        expect(Number((await getCharacter()).total_xp)).toBe(xpBefore + 20);
    });

    it('並行実行: 同一battle_attemptを2本の別キーで同時resolveしてもXPは1回分', async () => {
        const winActions = Array.from({ length: 12 }, () => ({ type: 'attack' }));
        const start = await callFn('start_battle_attempt', { stage: 1, idempotencyKey: uuid() });
        const attempt = (await start.json()) as { battle_attempt_id: string };
        const xpBefore = Number((await getCharacter()).total_xp);

        const [a, b] = await Promise.all([
            callFn('resolve_battle_attempt', {
                battleAttemptId: attempt.battle_attempt_id, actions: winActions, idempotencyKey: uuid(),
            }),
            callFn('resolve_battle_attempt', {
                battleAttemptId: attempt.battle_attempt_id, actions: winActions, idempotencyKey: uuid(),
            }),
        ]);
        const bodies = await Promise.all([a.json(), b.json()]) as { granted: boolean }[];
        expect(bodies.filter((body) => body.granted)).toHaveLength(1);
        expect(Number((await getCharacter()).total_xp)).toBe(xpBefore + 5);
    });

    it('冪等キーを別操作へ再利用すると拒否される', async () => {
        const key = uuid();
        const taskId = await createTask('キー再利用元');
        const first = await callFn('complete_task', { taskId, idempotencyKey: key });
        expect(first.status).toBe(200);

        // 同じキーで別操作（sell_item）を呼ぶ → 操作不一致で拒否
        const itemId = uuid();
        await insertWithVersion(async (v) => {
            await pg.query(
                `insert into inventory_items (id, user_id, template_id, version) values ($1, $2, 'wooden_sword', $3)`,
                [itemId, user.id, v],
            );
        });
        const reuse = await callFn('sell_item', { itemId, idempotencyKey: key });
        expect(reuse.status).toBe(500);
        expect(((await reuse.json()) as { error: string }).error).toContain('idempotency_key_operation_mismatch');
    });

    // gacha_count/total_xp累積を前提にする他テストへ影響しないよう最後に置く
    it('complete_task: stats_daily.task_xpが当日分へ継続加算される（他端末での実績復元用）', async () => {
        const today = getTodayJst();
        const before = await pg.query(
            'select task_xp from stats_daily where user_id=$1 and date=$2',
            [user.id, today],
        );
        const beforeXp = Number(before.rows[0]?.task_xp ?? 0);

        const taskId = await createTask('stats_daily継続更新テスト');
        const res = await callFn('complete_task', { taskId, idempotencyKey: uuid() });
        expect(((await res.json()) as { granted: boolean }).granted).toBe(true);

        const after = await pg.query(
            'select task_xp from stats_daily where user_id=$1 and date=$2',
            [user.id, today],
        );
        expect(Number(after.rows[0].task_xp)).toBe(beforeXp + 20); // medium = 20 XP

        // 同一キー再送は副作用なし（task_xpも二重加算されない）
        const replayKey = uuid();
        const replayTaskId = await createTask('再送テスト');
        await callFn('complete_task', { taskId: replayTaskId, idempotencyKey: replayKey });
        const afterFirst = await pg.query(
            'select task_xp from stats_daily where user_id=$1 and date=$2',
            [user.id, today],
        );
        await callFn('complete_task', { taskId: replayTaskId, idempotencyKey: replayKey });
        const afterReplay = await pg.query(
            'select task_xp from stats_daily where user_id=$1 and date=$2',
            [user.id, today],
        );
        expect(Number(afterReplay.rows[0].task_xp)).toBe(Number(afterFirst.rows[0].task_xp));
    });
});
