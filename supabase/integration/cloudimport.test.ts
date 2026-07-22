// @vitest-environment node
/**
 * #506 クラウド取り込みの統合テスト（フローA/B・ADR-011）。
 * 実行条件はspike.test.tsと同じ（EF検証のためSUPABASE_FUNCTIONS_URLも必須）。
 */
import { beforeAll, describe, expect, it } from 'vitest';
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
    await client.auth.signInWithPassword({ email, password: 'password-123' });
    const { data: session } = await client.auth.getSession();
    return { id: data.user.id, client, token: session.session!.access_token };
}

const webSnapshot = {
    tasks: [
        {
            id: '1751000000000-webtask1', name: 'Webのタスク', dueDate: '2026-07-10', priority: 'high',
            tags: ['重要'], recurrence: 'none', completed: true, completedAt: '2026-07-02T00:00:00.000Z',
            createdAt: '2026-07-01T00:00:00.000Z',
            subtasks: [{ id: '1751000000001-sub1', name: 'Webの子', completed: true, completedAt: '2026-07-02T00:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z' }],
        },
    ],
    habits: [{ id: '1751000000002-habit1', name: 'Webの習慣', categoryId: 'health', createdAt: '2026-07-01T00:00:00.000Z' }],
    dailyRecords: [{ habitId: '1751000000002-habit1', date: '2026-07-01', completed: true, memo: 'メモ' }],
    restDays: [{ date: '2026-07-03', isRest: true }],
    allCompleteDates: ['2026-07-01'],
    statsDaily: [{ date: '2026-07-01', taskXp: 30, habitCount: 1, allComplete: true }],
    rewardLedger: { rewardedTaskIds: ['1751000000000-webtask1'], rewardedSubtaskIds: [], habitBonusDates: ['2026-07-01'] },
    character: { name: 'Web勇者', avatar: 'male', totalXp: 1234, gachaCount: 12, battleUnlocked: true, currentStage: 4, maxClearedStage: 3 },
    equipment: [{ templateId: 'iron_sword', equipped: true }],
    chestQueue: [{ chestType: 'silver', label: '銀の宝箱', isStarterCharacter: false, opened: false }],
    activeTitle: '冒険王',
    // notifiedTaskIdsはallowlist外（sanitizeImportSettingsで剥がされることを確認する）
    settings: { themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21, notifiedTaskIds: ['should-be-stripped'] },
};

describe.skipIf(!enabled)('#506 クラウド取り込み（ローカルSupabase統合）', () => {
    let user: Awaited<ReturnType<typeof createUser>>;
    let pg: PgClient;

    const callFn = (name: string, body: unknown, token = user.token) =>
        fetch(`${FUNCTIONS_URL}/${name}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

    beforeAll(async () => {
        pg = new PgClient({ connectionString: DB_URL });
        await pg.connect();
        user = await createUser(`import-${Date.now()}@example.com`);
    }, 30000);

    it('フローAの基準強制: Mobileが先に初回移行を試みるとサーバーが拒否し、何も書き込まれない', async () => {
        const res = await callFn('import_snapshot', {
            platform: 'mobile', snapshot: webSnapshot, idempotencyKey: uuid(),
        });
        expect(res.status).toBe(409);
        expect(((await res.json()) as { error: string }).error).toContain('web_migration_required');

        const { rows } = await pg.query(
            'select (select count(*) from tasks where user_id=$1) as tasks, (select imported_at from profiles where user_id=$1) as imported_at',
            [user.id],
        );
        expect(rows[0].tasks).toBe('0');
        expect(rows[0].imported_at).toBeNull();
    });

    it('フローB前提の強制: Web初回移行前のimport_mobile_contentも拒否される', async () => {
        const res = await callFn('import_mobile_content', {
            content: { tasks: [{ ...webSnapshot.tasks[0], id: 'mobile-task-x' }] },
            idempotencyKey: uuid(),
        });
        expect(res.status).toBe(409);
        expect(((await res.json()) as { error: string }).error).toContain('web_migration_required');
    });

    it('フローA: Web初回移行で全コレクション・ゲーム状態・証跡・基準値が反映される', async () => {
        const res = await callFn('import_snapshot', {
            platform: 'web', snapshot: webSnapshot, idempotencyKey: uuid(),
        });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { imported: boolean }).imported).toBe(true);

        // コレクション（client_idで取り込まれ、実IDはUUID採番）
        const { rows: tasks } = await pg.query(
            'select id, client_id, name, priority, completed, due_date::text from tasks where user_id=$1', [user.id]);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
            client_id: '1751000000000-webtask1', name: 'Webのタスク', priority: 'high',
            completed: true, due_date: '2026-07-10',
        });
        const { rows: subtasks } = await pg.query(
            'select client_id, task_id from subtasks where user_id=$1', [user.id]);
        expect(subtasks[0].client_id).toBe('1751000000001-sub1');
        expect(subtasks[0].task_id).toBe(tasks[0].id); // 参照がclient_id経由で解決されている

        const { rows: logs } = await pg.query('select count(*) from habit_logs where user_id=$1', [user.id]);
        expect(logs[0].count).toBe('1');

        // ゲーム状態
        const { rows: characters } = await pg.query(
            'select name, total_xp, gacha_count, battle_unlocked, max_cleared_stage, version from characters where user_id=$1', [user.id]);
        expect(characters[0]).toMatchObject({
            name: 'Web勇者', total_xp: '1234', gacha_count: '12', battle_unlocked: true, max_cleared_stage: 3,
        });
        const { rows: items } = await pg.query(
            "select template_id, equipped from inventory_items where user_id=$1", [user.id]);
        expect(items).toEqual([{ template_id: 'iron_sword', equipped: true }]);

        // 設定（allowlist外のnotifiedTaskIdsは剥がされ、他コレクションと同一の移行versionを共有する）
        const { rows: settingsRows } = await pg.query(
            'select settings, version from user_settings where user_id=$1', [user.id]);
        expect(settingsRows[0].settings).toEqual({
            themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21,
        });
        expect(settingsRows[0].version).toBe(characters[0].version);

        // 証跡（xp_delta=0）と基準値（migration_baseline = 実行直前のtotal_xp）
        const { rows: ledger } = await pg.query(
            'select kind, xp_delta from reward_transactions where user_id=$1 order by kind', [user.id]);
        const kinds = Object.fromEntries(ledger.map((row: { kind: string; xp_delta: number }) => [row.kind, row.xp_delta]));
        expect(kinds.task_complete).toBe(0);
        expect(kinds.subtask_complete).toBe(0);
        expect(kinds.habit_all_complete).toBe(0);
        expect(kinds.migration_baseline).toBe(1234);

        // プロフィールの移行メタデータ
        const { rows: profile } = await pg.query(
            'select imported_at, migrated_from, active_title from profiles where user_id=$1', [user.id]);
        expect(profile[0].imported_at).not.toBeNull();
        expect(profile[0].migrated_from).toBe('web');
        expect(profile[0].active_title).toBe('冒険王');
    });

    it('二重取り込み防止: 再importは副作用なしでalready_importedを返す', async () => {
        const res = await callFn('import_snapshot', {
            platform: 'web', snapshot: webSnapshot, idempotencyKey: uuid(),
        });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { already_imported: boolean }).already_imported).toBe(true);

        const { rows } = await pg.query('select count(*) from tasks where user_id=$1', [user.id]);
        expect(rows[0].count).toBe('1'); // 増えていない
    });

    it('証跡の生涯1回ゲート: 移行済みタスクの完了報告は報酬を再付与しない（ADR-003連携）', async () => {
        const { rows: tasks } = await pg.query(
            "select id from tasks where user_id=$1 and client_id='1751000000000-webtask1'", [user.id]);
        const res = await callFn('complete_task', { taskId: tasks[0].id, idempotencyKey: uuid() });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { granted: boolean }).granted).toBe(false); // xp_delta=0の枠取りが効く

        const { rows: character } = await pg.query('select total_xp from characters where user_id=$1', [user.id]);
        expect(character[0].total_xp).toBe('1234'); // XP不変
    });

    it('フローB: 承認されたMobile固有コンテンツのみ統合され、複数回試行でも重複しない', async () => {
        const mobileContent = {
            tasks: [{
                id: 'mobile-local-1', name: 'Mobileのタスク', dueDate: null, priority: 'low',
                tags: [], recurrence: 'none', completed: true, completedAt: '2026-07-05T00:00:00.000Z',
                createdAt: '2026-07-04T00:00:00.000Z', subtasks: [],
            }],
            habits: [{ id: 'mobile-habit-1', name: 'Mobileの習慣', categoryId: 'general', createdAt: '2026-07-04T00:00:00.000Z' }],
            dailyRecords: [{ habitId: 'mobile-habit-1', date: '2026-07-05', completed: true, memo: '' }],
        };

        const first = await callFn('import_mobile_content', { content: mobileContent, idempotencyKey: uuid() });
        expect(first.status).toBe(200);

        const { rows: afterFirst } = await pg.query(
            "select count(*) from tasks where user_id=$1 and client_id='mobile-local-1'", [user.id]);
        expect(afterFirst[0].count).toBe('1');

        // 同じ内容を別キーで再統合 → unique(user_id, client_id) と on conflict で重複しない
        const second = await callFn('import_mobile_content', { content: mobileContent, idempotencyKey: uuid() });
        expect(second.status).toBe(200);
        const { rows: counts } = await pg.query(
            `select (select count(*) from tasks where user_id=$1 and client_id='mobile-local-1') as tasks,
                    (select count(*) from habits where user_id=$1 and client_id='mobile-habit-1') as habits,
                    (select count(*) from reward_transactions where user_id=$1 and kind='task_complete' and xp_delta=0) as zero_grants`,
            [user.id],
        );
        expect(counts[0].tasks).toBe('1');
        expect(counts[0].habits).toBe('1');
        // 証跡: Web移行分(タスク1) + Mobile統合分(タスク1) の2件から増えない
        expect(Number(counts[0].zero_grants)).toBe(2);
    });

    it('不正envelope: 構造が壊れたsnapshotは拒否され、サーバー状態は変わらない', async () => {
        const before = await pg.query('select count(*) from tasks where user_id=$1', [user.id]);
        const res = await callFn('import_mobile_content', {
            content: 'not-an-object', idempotencyKey: uuid(),
        });
        expect(res.status).toBe(400);
        const after = await pg.query('select count(*) from tasks where user_id=$1', [user.id]);
        expect(after.rows[0].count).toBe(before.rows[0].count);
    });
});
