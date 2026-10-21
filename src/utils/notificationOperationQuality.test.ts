import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createTask, type Task } from '@life-quest/core/tasks';
import { runNotificationChecks, cancelNotificationChecks } from './notifications';
import { runMobileNotificationChecks, registerNotificationChecks } from '../../apps/mobile/src/platform/notifications';
import { useNotificationStore } from '../stores/useNotificationStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useHabitStore } from '../stores/useHabitStore';
import { useMobileSettingsStore } from '../../apps/mobile/src/stores/useMobileSettingsStore';
import { useMobileTaskStore } from '../../apps/mobile/src/stores/useMobileTaskStore';
import { useMobileHabitStore } from '../../apps/mobile/src/stores/useMobileHabitStore';

const mocks = vi.hoisted(() => ({ permission: vi.fn(), nativeDelivery: vi.fn(), webDelivery: vi.fn(), registration: vi.fn(),
    state: 'active', listeners: new Set<(state: string) => void>(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) } }));
vi.mock('react-native', () => ({ AppState: {
    get currentState() { return mocks.state; },
    addEventListener: (_type: string, callback: (state: string) => void) => { mocks.listeners.add(callback); return { remove: () => mocks.listeners.delete(callback) }; },
} }));
vi.mock('expo-notifications', () => ({ getPermissionsAsync: mocks.permission, scheduleNotificationAsync: mocks.nativeDelivery, setNotificationHandler: vi.fn() }));
class NotificationStub { static permission = 'granted'; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const task = (id = 'one'): Task => createTask({ id, name: `Task ${id}`, dueDate: '2026-10-21', now: '2026-10-20T00:00:00Z' })!;
const habit = { id: 'habit', name: '読書', categoryId: 'study', createdAt: '2026-10-20T00:00:00Z' };
let visibility = 'visible';
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T21:00:00+09:00'));
    mocks.state = 'active'; visibility = 'visible'; mocks.listeners.clear();
    mocks.permission.mockReset().mockResolvedValue({ granted: true }); mocks.nativeDelivery.mockReset().mockResolvedValue('fixture'); mocks.webDelivery.mockReset().mockResolvedValue(undefined);
    mocks.registration.mockReset().mockResolvedValue({ showNotification: mocks.webDelivery });
    vi.stubGlobal('Notification', NotificationStub);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: mocks.registration } });
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState);
    useNotificationStore.setState({ enabled: true, habitReminderHour: 20, notifiedTaskIds: [], lastHabitReminderDate: null });
    useMobileSettingsStore.setState({ notificationsEnabled: true, hasHydrated: true, habitReminderHour: 20, notifiedTaskIds: [], lastHabitReminderDate: null });
    useTaskStore.setState({ tasks: [task()], pendingCompletions: [] }); useHabitStore.setState({ habits: [], dailyRecords: [], restDays: [] });
    useMobileTaskStore.setState({ tasks: [task()], pendingCompletions: [], hasHydrated: true }); useMobileHabitStore.setState({ habits: [], records: [], restDays: [], hasHydrated: true });
});
afterEach(() => { cancelNotificationChecks(); resetAuthLifecycleHooks(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
for (const platform of ['web', 'native'] as const) describe(`${platform}: notification operation boundaries`, () => {
    const run = platform === 'web' ? runNotificationChecks : runMobileNotificationChecks;
    const delivered = platform === 'web' ? mocks.webDelivery : mocks.nativeDelivery;
    const history = () => platform === 'web' ? useNotificationStore.getState().notifiedTaskIds : useMobileSettingsStore.getState().notifiedTaskIds;
    const reminderDate = () => platform === 'web' ? useNotificationStore.getState().lastHabitReminderDate : useMobileSettingsStore.getState().lastHabitReminderDate;
    const setTasks = (tasks: Task[]) => { if (platform === 'web') useTaskStore.setState({ tasks }); else useMobileTaskStore.setState({ tasks }); };
    const enabled = (value: boolean) => { if (platform === 'web') useNotificationStore.setState({ enabled: value }); else useMobileSettingsStore.setState({ notificationsEnabled: value }); };
    const pauseBeforeSend = () => {
        if (platform === 'web') { const wait = deferred<{ showNotification: typeof mocks.webDelivery }>(); mocks.registration.mockReturnValueOnce(wait.promise); return () => wait.resolve({ showNotification: mocks.webDelivery }); }
        const wait = deferred<{ granted: boolean }>(); mocks.permission.mockReturnValueOnce(wait.promise); return () => wait.resolve({ granted: true });
    };
    const background = () => {
        if (platform === 'web') { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); }
        else { mocks.state = 'background'; mocks.listeners.forEach((callback) => callback('background')); mocks.state = 'active'; mocks.listeners.forEach((callback) => callback('active')); }
    };
    const seedHabit = () => {
        setTasks([]); if (platform === 'web') useHabitStore.setState({ habits: [habit] }); else useMobileHabitStore.setState({ habits: [habit] });
    };
    it.each(['switch', 'logout', 'roundtrip', 'off-on', 'background'])('%s中の古い許可/SW取得結果から送信しない', async (kind) => {
        const resume = pauseBeforeSend(); const pending = run(); await Promise.resolve();
        if (kind === 'switch') await notifyLogin('b'); if (kind === 'logout') await notifyLogout();
        if (kind === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); }
        if (kind === 'off-on') { enabled(false); enabled(true); } if (kind === 'background') background();
        resume(); await pending; expect(delivered).not.toHaveBeenCalled(); expect(history()).toEqual([]);
        await run(); expect(delivered).toHaveBeenCalledOnce(); expect(history()).toEqual(['one']);
    });
    it('同一ユーザー通知と同値pullでは通常送信を維持する', async () => {
        const resume = pauseBeforeSend(); const pending = run(); await Promise.resolve(); await notifyLogin('a'); setTasks([task()]); enabled(true); resume(); await pending;
        expect(delivered).toHaveBeenCalledOnce(); expect(history()).toEqual(['one']);
    });
    it('旧処理のfinallyで別アカウントの実行ロックを解除しない', async () => {
        const oldResume = pauseBeforeSend(); const old = run(); await Promise.resolve(); await notifyLogin('b'); const currentResume = pauseBeforeSend(); const current = run(); await Promise.resolve();
        oldResume(); await old; await run(); expect(delivered).not.toHaveBeenCalled(); currentResume(); await current;
        expect(delivered).toHaveBeenCalledOnce(); expect(history()).toEqual(['one']);
    });
    it.each(['switch', 'logout', 'off-on', 'background'])('OS受付後の%sでは旧完了記録・次の通知を反映しない', async (kind) => {
        setTasks([task(), task('two')]); const wait = deferred<never>(); delivered.mockReturnValueOnce(wait.promise); const pending = run();
        await vi.waitFor(() => expect(delivered).toHaveBeenCalledOnce());
        if (kind === 'switch') await notifyLogin('b'); if (kind === 'logout') await notifyLogout();
        if (kind === 'off-on') { enabled(false); enabled(true); } if (kind === 'background') background();
        wait.resolve(undefined as never); await pending; expect(delivered).toHaveBeenCalledOnce(); expect(history()).toEqual([]);
    });
    it.each(['changed', 'completed', 'deleted'])('前の送信待ち中に%sとなった次のタスクを送らない', async (kind) => {
        setTasks([task(), task('two')]); const wait = deferred<never>(); delivered.mockReturnValueOnce(wait.promise); const pending = run();
        await vi.waitFor(() => expect(delivered).toHaveBeenCalledOnce());
        const second = task('two'); if (kind === 'changed') second.name = '更新後'; if (kind === 'completed') second.completed = true;
        setTasks(kind === 'deleted' ? [task()] : [task(), second]); wait.resolve(undefined as never); await pending;
        expect(delivered).toHaveBeenCalledOnce(); expect(history()).toEqual(['one']);
    });
    it('OS受付後の同ID差し替えでは新しいタスクを通知済みにしない', async () => {
        const wait = deferred<never>(); delivered.mockReturnValueOnce(wait.promise); const pending = run(); await vi.waitFor(() => expect(delivered).toHaveBeenCalledOnce());
        setTasks([{ ...task(), name: '差し替えた新しいタスク' }]); wait.resolve(undefined as never); await pending; expect(history()).toEqual([]);
    });
    it.each(['switch', 'off', 'day', 'rest', 'completed', 'hour'])('習慣通知受付後の%sで旧リマインダー記録を反映しない', async (kind) => {
        seedHabit(); const wait = deferred<never>(); delivered.mockReturnValueOnce(wait.promise); const pending = run(); await vi.waitFor(() => expect(delivered).toHaveBeenCalledOnce());
        if (kind === 'switch') await notifyLogin('b'); if (kind === 'off') enabled(false);
        if (kind === 'day') vi.setSystemTime(new Date('2026-10-22T00:01:00+09:00'));
        if (kind === 'hour') { if (platform === 'web') useNotificationStore.setState({ habitReminderHour: 22 }); else useMobileSettingsStore.setState({ habitReminderHour: 22 }); }
        if (kind === 'rest') { const restDays = [{ date: '2026-10-21', isRest: true }]; if (platform === 'web') useHabitStore.setState({ restDays }); else useMobileHabitStore.setState({ restDays }); }
        if (kind === 'completed') { const records = [{ habitId: 'habit', date: '2026-10-21', completed: true, memo: '' }]; if (platform === 'web') useHabitStore.setState({ dailyRecords: records }); else useMobileHabitStore.setState({ records }); }
        wait.resolve(undefined as never); await pending; expect(reminderDate()).toBeNull();
    });
    it('送信失敗なら既通知にせず同じセッションで再試行できる', async () => {
        delivered.mockRejectedValueOnce(new Error('fixture')); await run(); expect(history()).toEqual([]); await run(); expect(delivered).toHaveBeenCalledTimes(2); expect(history()).toEqual(['one']);
    });
    if (platform === 'web') it.each(['changed', 'deleted', 'completed'])('SW待機中の対象%sを送信しない', async (kind) => {
        const resume = pauseBeforeSend(); const pending = run(); await Promise.resolve(); const next = { ...task(), name: kind === 'changed' ? '別名' : task().name, completed: kind === 'completed' };
        setTasks(kind === 'deleted' ? [] : [next]); resume(); await pending; expect(delivered).not.toHaveBeenCalled(); expect(history()).toEqual([]);
    });
    if (platform === 'native') {
        it('復元前・非表示中はチェックを開始しない', async () => {
            useMobileSettingsStore.setState({ hasHydrated: false }); await run(); useMobileSettingsStore.setState({ hasHydrated: true }); mocks.state = 'background'; await run(); expect(mocks.permission).not.toHaveBeenCalled();
        });
        it('定期チェック解除後は未完了の許可確認から通知しない', async () => {
            const resume = pauseBeforeSend(); const stop = registerNotificationChecks(); stop(); resume(); await Promise.resolve(); await Promise.resolve();
            expect(delivered).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
        });
    }
    it('認証切替のストア初期化が終わるまで旧表示データを通知しない', async () => {
        const transition = deferred<void>(); const unregister = registerAuthLifecycleHooks({ onLogin: () => transition.promise });
        const login = notifyLogin('b'); const pending = run(); await Promise.resolve(); expect(delivered).not.toHaveBeenCalled();
        setTasks([{ ...task(), name: '新アカウントのタスク' }]); transition.resolve(); await login; await pending;
        expect(delivered).toHaveBeenCalledOnce(); expect(JSON.stringify(delivered.mock.calls)).toContain('新アカウントのタスク'); unregister();
    });
});
