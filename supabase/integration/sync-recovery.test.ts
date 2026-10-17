// @vitest-environment node
/** Real backend + production controller/RPC/Edge/pull/cache code.
 * Network faults and disk restart are simulated; this is not device UI/staging QA.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createAccountBoundOutboxRpcClient, createCloudOutboxController } from '@life-quest/core/cloudOutboxController';
import { createEdgeFunctionInvoker } from '@life-quest/core/edgeFunctions';
import { cloudCursorKey, createCloudPullRunner, type PullBatch } from '@life-quest/core/cloudPull';
import { applyPullBatchToCache, buildCanonicalGameSnapshot, buildCanonicalHabitSnapshot, buildCanonicalTaskSnapshot,
    buildStatsLogSnapshot, extractSyncedSettings, loadCloudCache, persistCloudCache } from '@life-quest/core/cloudCache';
import { getTodayJst } from '@life-quest/core/dates';
import { assertLocalSyncEnvironment, syncEnvironmentKeys } from '../../scripts/run-sync-quality.mjs';

const env = process.env;
const enabled = syncEnvironmentKeys.every((key) => Boolean(env[key]));
const api = env.SUPABASE_URL ?? '';
const anon = env.SUPABASE_ANON_KEY ?? '';
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const storage = () => {
    const map = new Map<string, string>();
    return { getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value); },
        removeItem: (key: string) => { map.delete(key); } };
};
type Storage = ReturnType<typeof storage>;
type User = { id: string; email: string; password: string };

async function createDevice(user: User, disk: Storage = storage(), initiallyOffline = false) {
    const network = { offline: false, loseNextCompletionResponse: false, lost: 0, completionKeys: [] as string[] };
    const transport: typeof fetch = async (input, init) => {
        if (network.offline) throw new TypeError('simulated offline');
        const url = input instanceof Request ? input.url : String(input);
        const completion = url.endsWith('/functions/v1/complete_task');
        if (completion) network.completionKeys.push(JSON.parse(String(init?.body)).idempotencyKey);
        const response = await fetch(input, init);
        if (completion && response.ok && network.loseNextCompletionResponse) {
            network.loseNextCompletionResponse = false;
            network.lost += 1;
            await response.arrayBuffer(); // Server committed; only delivery of the response is lost.
            throw new TypeError('simulated lost response after commit');
        }
        return response;
    };
    const client = createClient(api, anon, { ...options, global: { fetch: transport } });
    const signedIn = await client.auth.signInWithPassword({ email: user.email, password: user.password });
    if (signedIn.error) throw new Error('Test device could not sign in');
    network.offline = initiallyOffline;
    const session = async () => {
        const { data, error } = await client.auth.getSession();
        if (error) throw new Error('Test device session unavailable');
        return data.session ? { accessToken: data.session.access_token, userId: data.session.user.id } : null;
    };
    const edge = createEdgeFunctionInvoker({ functionsUrl: env.SUPABASE_FUNCTIONS_URL!, anonKey: anon,
        getSession: session, refreshSession: async () => {
            const { data, error } = await client.auth.refreshSession();
            return !error && data.session ? { accessToken: data.session.access_token, userId: data.session.user.id } : null;
        }, fetchFn: transport });
    const controller = createCloudOutboxController({ storage: disk,
        getRpcClient: (scope) => createAccountBoundOutboxRpcClient({
            getSession: async () => ({ session: await session() }),
            call: async (name, params, token) => {
                const { error, status } = await client.rpc(name, params).setHeader('Authorization', `Bearer ${token}`);
                return { error, status };
            },
        }, scope), getEdgeInvoker: () => edge });
    const unregister = controller.registerHooks();
    let active = true;
    let cache = await loadCloudCache(disk, user.id);
    const afterVersions: number[] = [];
    const pull = createCloudPullRunner({ isActive: () => active,
        fetchBatch: async (cursor, limit) => {
            afterVersions.push(cursor);
            const { data, error } = await client.rpc('pull_sync_batch', { p_after_version: cursor, p_max_versions: limit });
            if (error) throw new Error('Test device pull failed');
            return data as PullBatch;
        },
        applyBatch: async (batch) => {
            cache = applyPullBatchToCache(cache, batch);
            await persistCloudCache(disk, user.id, cache, () => active);
        },
        readCursor: async () => Number(disk.getItem(cloudCursorKey(user.id)) ?? 0),
        writeCursor: async (cursor) => { disk.setItem(cloudCursorKey(user.id), String(cursor)); },
    });
    return { controller, network, disk, pull, afterVersions,
        tasks: () => buildCanonicalTaskSnapshot(cache).tasks,
        habits: () => buildCanonicalHabitSnapshot(cache),
        game: () => buildCanonicalGameSnapshot(cache),
        stats: () => buildStatsLogSnapshot(cache), settings: () => extractSyncedSettings(cache),
        close: async () => {
            active = false;
            const outbox = controller.getActiveOutbox();
            unregister();
            await outbox?.stop();
            client.auth.stopAutoRefresh();
        },
    };
}

describe.skipIf(!enabled)('同期復帰：実送信アダプタとローカルDB/Edge', () => {
    let admin: ReturnType<typeof createClient>;
    let user: User;
    let devices: Awaited<ReturnType<typeof createDevice>>[] = [];
    let createdUserId: string | null = null;
    beforeAll(() => { assertLocalSyncEnvironment(env); admin = createClient(api, env.SUPABASE_SERVICE_ROLE_KEY!, options); });
    beforeEach(async () => {
        resetAuthLifecycleHooks(); devices = []; createdUserId = null;
        const email = `sync-recovery-${crypto.randomUUID()}@example.com`;
        const password = 'local-test-password-123';
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error || !data.user) throw new Error('Test account creation failed');
        createdUserId = data.user.id;
        user = { id: data.user.id, email, password };
    }, 30000);
    afterEach(async () => {
        await Promise.all(devices.map((device) => device.close()));
        resetAuthLifecycleHooks();
        // Only the disposable user created by this test; no DB reset/truncate.
        if (createdUserId) {
            const { error } = await admin.auth.admin.deleteUser(createdUserId);
            if (error) throw new Error('Disposable test account cleanup failed');
        }
    });
    async function device(disk?: Storage, offline = false) {
        const value = await createDevice(user, disk, offline); devices.push(value); return value;
    }
    async function start() { await notifyLogin(user.id); }
    async function converge(...values: Awaited<ReturnType<typeof createDevice>>[]) {
        for (const value of values) await value.pull.flush();
    }
    async function enqueue(value: Awaited<ReturnType<typeof createDevice>>, name: string, payload: Record<string, unknown>,
        tracking: { trackEntityId?: string; dependsOnEntityIds?: string[] } = {}) {
        expect(await value.controller.enqueue(name, payload, tracking)).toBe(true);
    }
    async function character() {
        const { data, error } = await admin.from('characters').select('total_xp,gacha_count').eq('user_id', user.id).single();
        expect(error).toBeNull(); return data!;
    }

    it('Web→Mobile作成とMobile→Web編集が全タスク項目/サブタスクを維持して収束する', async () => {
        const web = await device(); const mobile = await device(); await start();
        web.network.offline = true;
        const id = crypto.randomUUID(); const child = crypto.randomUUID();
        await enqueue(web, 'upsert_task', { p_id: id, p_name: 'Webの作成', p_due_date: '2026-10-20',
            p_priority: 'high', p_recurrence: 'weekly', p_tags: ['仕事', 'web'] }, { trackEntityId: id });
        await enqueue(web, 'upsert_subtask', { p_id: child, p_task_id: id, p_name: '子タスク' }, { dependsOnEntityIds: [id] });
        await web.controller.getActiveOutbox()!.flush();
        expect(web.controller.getActiveOutbox()!.snapshot()).toHaveLength(2);
        web.network.offline = false; expect((await web.controller.retryPending()).retryablePending).toBe(false);
        await converge(web, mobile);
        expect(web.tasks()).toEqual(mobile.tasks());
        expect(mobile.tasks()[0]).toMatchObject({ id, name: 'Webの作成', dueDate: '2026-10-20', priority: 'high',
            recurrence: 'weekly', tags: ['仕事', 'web'], subtasks: [{ id: child, name: '子タスク' }] });

        mobile.network.offline = true;
        await enqueue(mobile, 'upsert_task', { p_id: id, p_name: 'Mobileで編集', p_due_date: '2026-10-21',
            p_priority: 'low', p_recurrence: 'daily', p_tags: ['mobile'] });
        await mobile.controller.getActiveOutbox()!.flush();
        mobile.network.offline = false; await mobile.controller.retryPending(); await converge(mobile, web);
        expect(web.tasks()).toEqual(mobile.tasks());
        expect(web.tasks()[0]).toMatchObject({ name: 'Mobileで編集', dueDate: '2026-10-21', priority: 'low',
            recurrence: 'daily', tags: ['mobile'], subtasks: [{ id: child }] });
    }, 30000);

    it('オフラインの習慣/メモ/休息日/設定を復帰後に反映し、逆方向の修正も収束する', async () => {
        const web = await device(); const mobile = await device(); await start();
        mobile.network.offline = true;
        const id = crypto.randomUUID(); const date = getTodayJst();
        await enqueue(mobile, 'upsert_habit', { p_id: id, p_name: '読書', p_category_id: 'growth' }, { trackEntityId: id });
        await enqueue(mobile, 'set_habit_log', { p_habit_id: id, p_date: date, p_completed: true, p_memo: '復帰前のメモ' }, { dependsOnEntityIds: [id] });
        await enqueue(mobile, 'set_rest_day', { p_date: date, p_active: true });
        await enqueue(mobile, 'upsert_user_settings', { p_settings: { themeMode: 'dark', motionMode: 'reduced',
            notificationsEnabled: false, habitReminderHour: 21 }, p_base_version: null });
        await mobile.controller.getActiveOutbox()!.flush(); expect(mobile.controller.getActiveOutbox()!.snapshot()).toHaveLength(4);
        mobile.network.offline = false; await mobile.controller.retryPending(); await converge(mobile, web);
        expect(web.habits()).toEqual(mobile.habits());
        expect(web.habits()).toMatchObject({ habits: [{ id, categoryId: 'growth' }], dailyRecords: [{ habitId: id, completed: true, memo: '復帰前のメモ' }],
            restDays: [{ date, isRest: true }] });
        expect(web.settings()).toEqual({ themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: false, habitReminderHour: 21 });
        await enqueue(web, 'set_habit_log', { p_habit_id: id, p_date: date, p_completed: false, p_memo: 'Webで追記' });
        await web.controller.drainAndWait(); await converge(web, mobile);
        expect(web.habits()).toEqual(mobile.habits());
        expect(mobile.habits().dailyRecords[0]).toMatchObject({ completed: false, memo: 'Webで追記' });
    }, 30000);

    it('キャッシュ/カーソルと削除待ちキューを再起動相当で復元し、墓標を両側へ反映する', async () => {
        const web = await device(); const mobile = await device(); await start();
        const id = crypto.randomUUID();
        await enqueue(web, 'upsert_task', { p_id: id, p_name: '削除予定' }); await web.controller.drainAndWait();
        await converge(web, mobile);
        const savedCursor = Number(mobile.disk.getItem(cloudCursorKey(user.id)));
        expect(savedCursor).toBeGreaterThan(0);
        mobile.network.offline = true;
        await enqueue(mobile, 'delete_task', { p_id: id }); await mobile.controller.getActiveOutbox()!.flush();
        const pendingId = mobile.controller.getActiveOutbox()!.snapshot()[0].opId;
        await mobile.close(); devices = devices.filter((d) => d !== mobile);
        const restored = await device(mobile.disk, true); await start();
        expect(restored.tasks()).toEqual(web.tasks()); // No network pull or fixture reseeding.
        expect(restored.controller.getActiveOutbox()!.snapshot()[0].opId).toBe(pendingId);
        restored.network.offline = false; await restored.controller.retryPending(); await converge(restored, web);
        expect(restored.afterVersions[0]).toBe(savedCursor);
        expect(restored.tasks()).toEqual([]); expect(web.tasks()).toEqual([]);
        expect(restored.controller.getActiveOutbox()!.snapshot()).toEqual([]);
    }, 30000);

    it('サーバー確定後の応答喪失→復元再送でも同じopIdでXP/回数/宝箱/統計を重複させない', async () => {
        const web = await device(); const mobile = await device(); await start();
        const id = crypto.randomUUID();
        await enqueue(web, 'upsert_task', { p_id: id, p_name: '応答喪失', p_priority: 'high' }); await web.controller.drainAndWait();
        mobile.network.loseNextCompletionResponse = true;
        await enqueue(mobile, 'complete_task', { taskId: id }); await mobile.controller.getActiveOutbox()!.flush();
        expect(mobile.network.lost).toBe(1);
        const opId = mobile.controller.getActiveOutbox()!.snapshot()[0].opId;
        expect(mobile.network.completionKeys).toEqual([opId]);
        await converge(web);
        const first = await character(); expect(Number(first.total_xp)).toBeGreaterThan(0); expect(Number(first.gacha_count)).toBe(1);
        const stats = web.stats(); const game = web.game();
        await mobile.close(); devices = devices.filter((d) => d !== mobile);
        const restored = await device(mobile.disk); await start(); await restored.controller.retryPending();
        expect(restored.controller.getActiveOutbox()!.snapshot()).toEqual([]);
        expect(restored.network.completionKeys.length).toBeGreaterThanOrEqual(1);
        expect(new Set(restored.network.completionKeys)).toEqual(new Set([opId]));
        await converge(restored, web);
        expect(await character()).toEqual(first);
        expect(restored.stats()).toEqual(stats); expect(web.stats()).toEqual(stats);
        expect(restored.game()).toEqual(game); expect(web.game()).toEqual(game);
        expect(web.tasks()[0]).toMatchObject({ id, completed: true }); expect(web.tasks()).toEqual(restored.tasks());
        const { count, error } = await admin.from('reward_transactions').select('*', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('kind', 'task_complete').eq('source_id', id);
        expect(error).toBeNull(); expect(count).toBe(1);
    }, 30000);
});
