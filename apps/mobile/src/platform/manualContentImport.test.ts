import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { cloudCacheKey } from '@life-quest/core/cloudCache';
import { buildMobileContentPayload, preMigrationBackupKey } from '@life-quest/core/cloudImport';
import { createEdgeFunctionInvoker, type EdgeFunctionInvoker } from '@life-quest/core/edgeFunctions';
import { HABIT_LIMITS } from '@life-quest/core/habits';
import { TASK_LIMITS } from '@life-quest/core/tasks';

const mocks = vi.hoisted(() => ({ values: new Map<string, string>(), getItem: vi.fn(),
    user: null as { userId: string; email: string | null } | null, invoke: null as EdgeFunctionInvoker | null }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: mocks.getItem, setItem: vi.fn(async () => undefined), removeItem: vi.fn(async () => undefined),
} }));
vi.mock('./auth', () => ({ getCurrentUser: async () => mocks.user }));
vi.mock('./edgeFunctions', () => ({ getMobileEdgeFunctionInvoker: () => mocks.invoke }));

import { approveMobileContentImport, getPendingMobileContent } from './cloudMigration';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';

function task(id: string, name = id) {
    return { id, name, dueDate: null, priority: 'medium' as const, tags: [], subtasks: [], recurrence: 'none' as const,
        completed: false, completedAt: null, createdAt: '2026-10-15T00:00:00Z' };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
const fetchFn = vi.fn();
const getSession = vi.fn();
const refreshSession = vi.fn();
const settle = async () => { await vi.dynamicImportSettled(); for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function login(id: string) { mocks.user = { userId: id, email: `${id}@example.invalid` }; await notifyLogin(id); }
beforeEach(async () => {
    resetAuthLifecycleHooks();
    mocks.values.clear();
    mocks.getItem.mockReset().mockImplementation(async (key: string) => mocks.values.get(key) ?? null);
    fetchFn.mockReset().mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    getSession.mockReset().mockImplementation(async () => mocks.user ? { userId: mocks.user.userId, accessToken: `token-${mocks.user.userId}` } : null);
    refreshSession.mockReset().mockImplementation(async () => mocks.user ? { userId: mocks.user.userId, accessToken: `renewed-${mocks.user.userId}` } : null);
    mocks.invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'test', getSession, refreshSession, fetchFn });
    useMobileTaskStore.setState({ tasks: [task('local')] });
    useMobileHabitStore.setState({ habits: [], records: [] });
    await login('a');
});
afterEach(() => { resetAuthLifecycleHooks(); vi.restoreAllMocks(); });

describe('Mobile手動統合の候補・承認・再試行', () => {
    it('上限ちょうどの習慣と先頭の記録はサーバー用payloadでも欠落しない', async () => {
        const habits = Array.from({ length: HABIT_LIMITS.maxHabits }, (_, i) => ({
            id: `h-${i}`, name: `habit ${i}`, categoryId: 'health', createdAt: '2026-10-15T00:00:00Z',
        }));
        mocks.values.set(preMigrationBackupKey('a'), JSON.stringify({ tasks: [], habits,
            dailyRecords: [{ habitId: 'h-0', date: '2026-10-15', completed: true, memo: 'retained' }] }));
        const pending = await getPendingMobileContent('a');
        const payload = buildMobileContentPayload(pending);
        expect(pending.habits).toHaveLength(HABIT_LIMITS.maxHabits);
        expect(payload.habits).toHaveLength(HABIT_LIMITS.maxHabits);
        expect(payload.habits[0].client_id).toBe('h-0');
        expect(payload.habit_logs).toHaveLength(1);
    });

    it.each(['tasks', 'habits', 'records'])('backupとliveの合成%sが上限を超えたら送信前に明示エラーにする', async (kind) => {
        const h = { id: 'h', name: 'habit', categoryId: 'health', createdAt: '2026-10-15T00:00:00Z' };
        const backup = { tasks: kind === 'tasks' ? Array.from({ length: TASK_LIMITS.maxTasks }, (_, i) => task(`saved-${i}`)) : [],
            habits: kind === 'habits' ? Array.from({ length: HABIT_LIMITS.maxHabits }, (_, i) => ({ ...h, id: `saved-${i}` })) : [h],
            dailyRecords: kind === 'records' ? Array.from({ length: HABIT_LIMITS.maxRecords }, (_, i) => ({
                habitId: 'h', date: new Date(Date.UTC(1800, 0, i + 1)).toISOString().slice(0, 10), completed: true, memo: '',
            })) : [] };
        const original = JSON.stringify(backup);
        mocks.values.set(preMigrationBackupKey('a'), original);
        useMobileTaskStore.setState({ tasks: kind === 'tasks' ? [task('one-extra')] : [] });
        useMobileHabitStore.setState({ habits: kind === 'habits' ? [{ ...h, id: 'one-extra' }] : [h],
            records: kind === 'records' ? [{ habitId: 'h', date: '2026-10-15', completed: true, memo: '' }] : [] });
        await expect(getPendingMobileContent('a')).rejects.toThrow('取り込み上限');
        expect(mocks.values.get(preMigrationBackupKey('a'))).toBe(original);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('同じIDの退避内容より現在の編集を優先し、記録も二重にしない', async () => {
        mocks.values.set(preMigrationBackupKey('a'), JSON.stringify({ tasks: [task('local', 'old name')],
            habits: [{ id: 'h', name: 'old habit', categoryId: 'health', createdAt: '2026-10-15T00:00:00Z' }],
            dailyRecords: [{ habitId: 'h', date: '2026-10-15', completed: false, memo: 'old' }] }));
        useMobileTaskStore.setState({ tasks: [task('local', 'current name')] });
        useMobileHabitStore.setState({ habits: [{ id: 'h', name: 'current habit', categoryId: 'health', createdAt: '2026-10-15T00:00:00Z' }],
            records: [{ habitId: 'h', date: '2026-10-15', completed: true, memo: 'current' }] });
        const pending = await getPendingMobileContent('a');
        expect(pending.tasks).toHaveLength(1);
        expect(pending.tasks[0].name).toBe('current name');
        expect(pending.habits[0].name).toBe('current habit');
        expect(pending.dailyRecords).toEqual([{ habitId: 'h', date: '2026-10-15', completed: true, memo: 'current' }]);
    });

    it('表示ユーザーと実セッションが違えば候補を発行しない', async () => {
        mocks.user = { userId: 'b', email: null }; // SDK metadata changed before its lifecycle notification.
        await expect(getPendingMobileContent('a')).rejects.toMatchObject({ code: 'stale-session' });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('Web初回移行が必要な失敗でも候補と再送キーを保持する', async () => {
        const pending = await getPendingMobileContent('a');
        fetchFn.mockResolvedValueOnce(new Response('{"error":"web_migration_required"}', { status: 409 }));
        expect(await approveMobileContentImport(pending)).toEqual({ status: 'web_migration_required' });
        expect(await approveMobileContentImport(pending)).toEqual({ status: 'imported' });
        expect(fetchFn.mock.calls[0][1].body).toBe(fetchFn.mock.calls[1][1].body);
    });

    it('クラウド置換後も退避済みのタスクと習慣ログを候補へ復元する', async () => {
        mocks.values.set(preMigrationBackupKey('a'), JSON.stringify({ tasks: [task('backed-up')],
            habits: [{ id: 'h-local', name: 'local habit', categoryId: 'health', createdAt: '2026-10-15T00:00:00Z' }],
            dailyRecords: [{ habitId: 'h-local', date: '2026-10-15', completed: true, memo: 'retained' }] }));
        useMobileTaskStore.setState({ tasks: [] });
        const pending = await getPendingMobileContent('a');
        expect(pending.tasks.map((item) => item.id)).toEqual(['backed-up']);
        expect(pending.habits.map((item) => item.id)).toEqual(['h-local']);
        expect(pending.dailyRecords[0].memo).toBe('retained');
        expect(fetchFn).not.toHaveBeenCalled();
        expect(mocks.values.has(preMigrationBackupKey('a'))).toBe(true);
    });

    it('クラウドの削除済み行やclient_idと一致する退避項目を復活させない', async () => {
        mocks.values.set(preMigrationBackupKey('a'), JSON.stringify({ tasks: [task('deleted-local'), task('remaining')], habits: [], dailyRecords: [] }));
        mocks.values.set(cloudCacheKey('a', 'tasks'), JSON.stringify({ tasks: {
            server: { id: 'server', client_id: 'deleted-local', version: 2, deleted_at: '2026-10-15T00:00:00Z' },
        }, subtasks: {} }));
        useMobileTaskStore.setState({ tasks: [] });
        expect((await getPendingMobileContent('a')).tasks.map((item) => item.id)).toEqual(['remaining']);
    });

    it('壊れたバックアップは保持して確認エラーにし、勝手に空の候補へ置換しない', async () => {
        mocks.values.set(preMigrationBackupKey('a'), '{broken');
        await expect(getPendingMobileContent('a')).rejects.toThrow();
        expect(mocks.values.get(preMigrationBackupKey('a'))).toBe('{broken');
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('キャッシュ取得待機中の切替後はBのストアをA向け候補として返さない', async () => {
        const read = deferred<string | null>();
        mocks.getItem.mockImplementation(async (key: string) => key === cloudCacheKey('a', 'tasks') ? read.promise : null);
        const pending = getPendingMobileContent('a');
        await settle();
        await login('b');
        useMobileTaskStore.setState({ tasks: [task('b-private')] });
        read.resolve(null);
        await expect(pending).rejects.toMatchObject({ code: 'stale-session' });
    });

    it.each(['logout', 'switch', 'return-to-a'])('取得済み候補は%s後に送信できない', async (transition) => {
        const pending = await getPendingMobileContent('a');
        if (transition === 'logout') { mocks.user = null; await notifyLogout(); }
        else await login('b');
        if (transition === 'return-to-a') await login('a');
        expect(await approveMobileContentImport(pending)).toEqual({ status: 'stale' });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('未取得の任意オブジェクトを承認しても送信しない', async () => {
        expect(await approveMobileContentImport({ tasks: [task('forged')], habits: [], dailyRecords: [] })).toEqual({ status: 'stale' });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('同時承認を1送信にまとめ、成功済み候補も再送しない', async () => {
        const pending = await getPendingMobileContent('a');
        const response = deferred<Response>();
        fetchFn.mockReturnValueOnce(response.promise);
        const first = approveMobileContentImport(pending);
        const repeated = approveMobileContentImport(pending);
        await settle();
        expect(fetchFn).toHaveBeenCalledTimes(1);
        response.resolve(new Response('{}', { status: 200 }));
        expect(await first).toEqual({ status: 'imported' });
        expect(await repeated).toEqual({ status: 'imported' });
        await approveMobileContentImport(pending);
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('応答喪失後は取得時の本文と冪等キーを維持して再試行する', async () => {
        const pending = await getPendingMobileContent('a');
        fetchFn.mockRejectedValueOnce(new TypeError('response lost'));
        expect((await approveMobileContentImport(pending)).status).toBe('error');
        pending.tasks[0].name = 'edited after confirmation';
        useMobileTaskStore.setState({ tasks: [task('new-live-data')] });
        expect(await approveMobileContentImport(pending)).toEqual({ status: 'imported' });
        const first = JSON.parse(fetchFn.mock.calls[0][1].body as string);
        const second = JSON.parse(fetchFn.mock.calls[1][1].body as string);
        expect(second).toEqual(first);
        expect(second.content.tasks[0].name).toBe('local');
    });

    it('トークン取得待機中に切り替わっても旧候補を送信しない', async () => {
        const pending = await getPendingMobileContent('a');
        const token = deferred<{ userId: string; accessToken: string }>();
        getSession.mockReturnValueOnce(token.promise);
        const importing = approveMobileContentImport(pending);
        await settle();
        expect(getSession).toHaveBeenCalledOnce();
        await login('b');
        token.resolve({ userId: 'b', accessToken: 'token-b' });
        expect(await importing).toEqual({ status: 'stale' });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('SDK通知前でもトークンの所有者が候補と違えば送信しない', async () => {
        const pending = await getPendingMobileContent('a');
        getSession.mockResolvedValueOnce({ userId: 'b', accessToken: 'token-b' });
        expect(await approveMobileContentImport(pending)).toEqual({ status: 'stale' });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('旧送信の成功応答が切替後に到着しても成功扱いしない', async () => {
        const pending = await getPendingMobileContent('a');
        const response = deferred<Response>();
        fetchFn.mockReturnValueOnce(response.promise);
        const importing = approveMobileContentImport(pending);
        await settle();
        await login('b');
        response.resolve(new Response('{}', { status: 200 }));
        expect(await importing).toEqual({ status: 'stale' });
    });
});
