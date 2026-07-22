// @vitest-environment node
/**
 * #507 2クライアント相互同期・RLS侵入・オフライン回帰テスト。
 *
 * Web初回移行でクラウドを初期化し、Mobile相当のoutbox操作を
 * オフライン再送で適用した後、Web相当の別キャッシュが同じ状態へ
 * 収束することを検証する。あわせて、別ユーザーが同じ操作・pullで
 * そのデータへアクセスできないことを確認する。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
    applyPullBatchToCache,
    buildCanonicalGameSnapshot,
    buildCanonicalTaskSnapshot,
    createEmptyCloudCache,
    extractSyncedSettings,
    getSeedableSections,
    type CloudCache,
} from '@life-quest/core/cloudCache';
import { cloudCursorKey, cloudOutboxKey, createCloudPullRunner, type PullBatch } from '@life-quest/core/cloudPull';
import { createSyncOutbox, type OutboxOp, type OutboxSendResult } from '@life-quest/core/syncOutbox';

const DB_URL = process.env.SUPABASE_DB_URL;
const API_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;
const enabled = Boolean(DB_URL && API_URL && ANON_KEY && SERVICE_KEY && FUNCTIONS_URL);

const uuid = () => crypto.randomUUID();

function createMemoryStorage() {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value); },
        removeItem: (key: string) => { map.delete(key); },
    };
}

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

function createDevice(user: { id: string; client: SupabaseClient }) {
    const storage = createMemoryStorage();
    let cache: CloudCache = createEmptyCloudCache();
    const runner = createCloudPullRunner({
        fetchBatch: async (afterVersion, maxVersions) => {
            const { data, error } = await user.client.rpc('pull_sync_batch', {
                p_after_version: afterVersion,
                p_max_versions: maxVersions,
            });
            if (error) throw new Error(error.message);
            return data as PullBatch;
        },
        applyBatch: (batch) => {
            cache = applyPullBatchToCache(cache, batch);
        },
        readCursor: async () => Number((await storage.getItem(cloudCursorKey(user.id))) ?? 0),
        writeCursor: async (cursor) => { await storage.setItem(cloudCursorKey(user.id), String(cursor)); },
    });
    return {
        storage,
        runner,
        get cache() { return cache; },
        taskSnapshot: () => buildCanonicalTaskSnapshot(cache),
        gameSnapshot: () => buildCanonicalGameSnapshot(cache),
    };
}

function makeSender(user: { client: SupabaseClient; token: string }, isOffline: () => boolean) {
    return async (op: OutboxOp): Promise<OutboxSendResult> => {
        if (isOffline()) return { ok: false, permanent: false, error: 'offline' };
        if (op.operation === 'complete_task') {
            const response = await fetch(`${FUNCTIONS_URL}/complete_task`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...op.payload, idempotencyKey: op.opId }),
            });
            if (response.ok) return { ok: true };
            return { ok: false, permanent: response.status >= 400 && response.status < 500, error: `http_${response.status}` };
        }
        const { error } = await user.client.rpc(op.operation, { ...op.payload, p_key: op.opId });
        if (!error) return { ok: true };
        return { ok: false, permanent: true, error: error.message };
    };
}

const initialWebSnapshot = {
    tasks: [{
        id: 'web-local-task-1',
        name: 'Webから移行した未完了タスク',
        dueDate: '2026-07-09',
        priority: 'high',
        tags: ['web'],
        recurrence: 'none',
        completed: false,
        completedAt: null,
        createdAt: '2026-07-08T00:00:00.000Z',
        subtasks: [],
    }],
    habits: [],
    dailyRecords: [],
    restDays: [],
    allCompleteDates: [],
    statsDaily: [],
    rewardLedger: { rewardedTaskIds: [], rewardedSubtaskIds: [], habitBonusDates: [] },
    character: {
        name: '同期テスター',
        avatar: 'female',
        totalXp: 40,
        gachaCount: 0,
        battleUnlocked: false,
        currentStage: 1,
        maxClearedStage: 0,
    },
    equipment: [],
    chestQueue: [],
    activeTitle: null,
};

describe.skipIf(!enabled)('#507 2クライアント同期E2E（ローカルSupabase統合）', () => {
    let user: Awaited<ReturnType<typeof createUser>>;
    let attacker: Awaited<ReturnType<typeof createUser>>;
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
        const suffix = Date.now();
        user = await createUser(`twoclient-${suffix}@example.com`);
        attacker = await createUser(`twoclient-attacker-${suffix}@example.com`);
    }, 30000);

    afterAll(async () => {
        await pg?.end();
    });

    it('Web初回移行→Mobileオフライン操作→Web再プルまで同じcanonical状態へ収束する', async () => {
        const importRes = await callFn('import_snapshot', {
            platform: 'web',
            snapshot: initialWebSnapshot,
            idempotencyKey: `web-import-${user.id}`,
        });
        expect(importRes.status).toBe(200);

        const webDevice = createDevice(user);
        const mobileDevice = createDevice(user);
        await webDevice.runner.flush();
        await mobileDevice.runner.flush();

        expect(webDevice.taskSnapshot()).toEqual(mobileDevice.taskSnapshot());
        expect(webDevice.gameSnapshot()?.character.totalXp).toBe(40);
        expect(mobileDevice.taskSnapshot().tasks.map((task) => task.name)).toEqual(['Webから移行した未完了タスク']);

        let offline = true;
        const outbox = createSyncOutbox({
            storage: createMemoryStorage(),
            storageKey: cloudOutboxKey(user.id),
            send: makeSender(user, () => offline),
        });
        await outbox.load();

        const mobileTaskId = uuid();
        const createOp = await outbox.enqueue({
            operation: 'upsert_task',
            payload: {
                p_id: mobileTaskId,
                p_name: 'Mobileオフライン作成タスク',
                p_due_date: '2026-07-10',
                p_priority: 'high',
                p_recurrence: 'none',
                p_tags: ['mobile', 'offline'],
            },
        });
        await outbox.enqueue({
            operation: 'complete_task',
            payload: { taskId: mobileTaskId },
            dependsOn: [createOp!.opId],
            opId: `complete-${mobileTaskId}`,
        });
        await outbox.flush();
        expect(outbox.snapshot()).toHaveLength(2);

        offline = false;
        outbox.requestDrain();
        await outbox.flush();
        expect(outbox.snapshot()).toHaveLength(0);

        await mobileDevice.runner.flush();
        await webDevice.runner.flush();

        const webTasks = webDevice.taskSnapshot().tasks;
        const mobileTasks = mobileDevice.taskSnapshot().tasks;
        expect(webTasks).toEqual(mobileTasks);
        expect(webTasks.find((task) => task.id === mobileTaskId)).toMatchObject({
            name: 'Mobileオフライン作成タスク',
            dueDate: '2026-07-10',
            priority: 'high',
            tags: ['mobile', 'offline'],
            completed: true,
        });
        expect(webDevice.gameSnapshot()?.character.totalXp).toBeGreaterThan(40);
    });

    it('RLS/所有者検証: 他ユーザーはpullでもEdge Functionでも対象ユーザーのデータへアクセスできない', async () => {
        const ownerDevice = createDevice(user);
        const attackerDevice = createDevice(attacker);
        await ownerDevice.runner.flush();
        await attackerDevice.runner.flush();

        const ownerTaskId = ownerDevice.taskSnapshot().tasks[0].id;
        expect(ownerTaskId).toBeTruthy();
        expect(attackerDevice.taskSnapshot().tasks.map((task) => task.id)).not.toContain(ownerTaskId);

        const attackComplete = await callFn(
            'complete_task',
            { taskId: ownerTaskId, idempotencyKey: uuid() },
            attacker.token,
        );
        expect(attackComplete.status).toBe(404);

        const attackSubtask = await attacker.client.rpc('upsert_subtask', {
            p_id: uuid(),
            p_task_id: ownerTaskId,
            p_name: '越境サブタスク',
            p_key: uuid(),
        });
        expect(attackSubtask.error?.message).toContain('not_found_or_forbidden');

        const { rows } = await pg.query(
            'select count(*) from subtasks where task_id=$1 and user_id=$2',
            [ownerTaskId, attacker.id],
        );
        expect(rows[0].count).toBe('0');
    });

    it('同時更新のLWW収束: 同一タスクを両クライアントで別名に変更→後発の書き込みが両側のプルで反映される', async () => {
        const webDevice = createDevice(user);
        const mobileDevice = createDevice(user);
        await webDevice.runner.flush();
        await mobileDevice.runner.flush();

        const taskId = webDevice.taskSnapshot().tasks[0].id;
        expect(taskId).toBeTruthy();

        // 「同時」はサーバー側で next_sync_version が直列化するため、
        // 収束先は必ず後発コミットの内容になる（LWW=最後にコミットしたRPCが勝つ）。
        const first = await user.client.rpc('upsert_task', {
            p_id: taskId, p_name: 'Web側が変更した名前', p_key: uuid(),
        });
        expect(first.error).toBeNull();
        const second = await user.client.rpc('upsert_task', {
            p_id: taskId, p_name: 'Mobile側が変更した名前', p_key: uuid(),
        });
        expect(second.error).toBeNull();
        expect(second.data.version).toBeGreaterThan(first.data.version);

        await webDevice.runner.flush();
        await mobileDevice.runner.flush();

        const webTask = webDevice.taskSnapshot().tasks.find((task) => task.id === taskId);
        const mobileTask = mobileDevice.taskSnapshot().tasks.find((task) => task.id === taskId);
        expect(webTask?.name).toBe('Mobile側が変更した名前');
        expect(mobileTask?.name).toBe('Mobile側が変更した名前');
    });

    it('設定同期: upsert_user_settingsで書いた値が別クライアントのプルへ収束し、未変更ユーザーはseedable対象外のまま', async () => {
        // 未変更ユーザー: サインアップ直後の初期行（settings='{}'）はseedable対象外であることを確認する
        const untouchedUser = await createUser(`twoclient-settings-untouched-${Date.now()}@example.com`);
        const untouchedDevice = createDevice(untouchedUser);
        await untouchedDevice.runner.flush();
        expect(getSeedableSections(untouchedDevice.cache).settings).toBe(false);

        // 別ユーザーで書き込み→別デバイスのプルへ収束することを確認する
        const settingsUser = await createUser(`twoclient-settings-${Date.now()}@example.com`);
        const writerDevice = createDevice(settingsUser);
        const readerDevice = createDevice(settingsUser);
        await writerDevice.runner.flush();
        await readerDevice.runner.flush();
        expect(getSeedableSections(readerDevice.cache).settings).toBe(false);

        const written = await settingsUser.client.rpc('upsert_user_settings', {
            p_settings: { themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21 },
            p_base_version: null,
            p_key: uuid(),
        });
        expect(written.error).toBeNull();

        await readerDevice.runner.flush();
        const seedable = getSeedableSections(readerDevice.cache);
        expect(seedable.settings).toBe(true);
        expect(extractSyncedSettings(readerDevice.cache)).toEqual({
            themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21,
        });
    });
});
