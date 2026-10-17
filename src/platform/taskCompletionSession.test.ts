import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createTask, type Task } from '@life-quest/core/tasks';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { useTaskStore, discardWebPendingTaskCompletions } from '../stores/useTaskStore';
import { useGameStore, sanitizeGameStoreState } from '../stores/useGameStore';
import { useStatsStore } from '../stores/useStatsStore';
import { clearWebCloudStores, markCloudSessionSeeded as markWeb, registerWebAuthStoreHooks, resetCloudSessionSeeded as resetWeb } from './authStores';
import { getCompletionRewardGeneration, resetCompletionRewardStorage } from './completionRewards';
import { useMobileTaskStore, discardMobilePendingTaskCompletions } from '../../apps/mobile/src/stores/useMobileTaskStore';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';
import { useMobileStatsStore } from '../../apps/mobile/src/stores/useMobileStatsStore';
import { clearMobileCloudStores, markCloudSessionSeeded as markMobile, registerMobileAuthStoreHooks, resetCloudSessionSeeded as resetMobile } from '../../apps/mobile/src/platform/authStores';

const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn(async () => true) }));
vi.mock('./cloudOutbox', () => ({ enqueueCloudOperation: enqueue, isWebCloudOutboxActive: () => false }));
vi.mock('../../apps/mobile/src/platform/cloudOutbox', () => ({ enqueueCloudOperation: enqueue, isCloudOutboxActive: () => false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined), removeItem: vi.fn(async () => undefined),
} }));
vi.mock('../stores/useLoginBonusStore', () => ({ beginLoginBonusCloudSession: vi.fn(), clearLoginBonusCloudSession: vi.fn() }));
vi.mock('../../apps/mobile/src/stores/useMobileLoginBonusStore', () => ({ beginMobileLoginBonusCloudSession: vi.fn(), clearMobileLoginBonusCloudSession: vi.fn() }));

const task = (id = 'same-id'): Task => ({ ...createTask({ id, name: id, now: '2026-10-17T00:00:00Z' })!, recurrence: 'daily' });
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}
beforeEach(() => {
    resetAuthLifecycleHooks(); resetWeb(); resetMobile();
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T03:00:00Z'));
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => unknown) => work() } });
    localStorage.clear();
    setGameRewardAuthorityState('anonymous');
    resetCompletionRewardStorage(() => useGameStore.setState({ ...sanitizeGameStoreState(undefined), completionRewardError: null }));
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true });
    useStatsStore.setState({ taskXpLog: {} });
    useMobileStatsStore.setState({ taskXpLog: {}, hasHydrated: true, seeded: true });
    useTaskStore.setState({ tasks: [task()], pendingCompletions: [] });
    useMobileTaskStore.setState({ tasks: [task()], pendingCompletions: [], hasHydrated: true });
    enqueue.mockClear();
});
afterEach(() => {
    discardWebPendingTaskCompletions(); discardMobilePendingTaskCompletions();
    resetAuthLifecycleHooks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

const clients = [
    { name: 'Web', register: registerWebAuthStoreHooks, mark: markWeb, clear: clearWebCloudStores,
        get: useTaskStore.getState, setTasks: (tasks: Task[]) => useTaskStore.setState({ tasks }),
        toggle: (id = 'same-id') => useTaskStore.getState().toggleComplete(id),
        flush: () => useTaskStore.getState().flushPendingCompletions(),
        xp: () => useGameStore.getState().character.totalXp, stats: () => useStatsStore.getState().taskXpLog },
    { name: 'Mobile', register: registerMobileAuthStoreHooks, mark: markMobile, clear: clearMobileCloudStores,
        get: useMobileTaskStore.getState, setTasks: (tasks: Task[]) => useMobileTaskStore.setState({ tasks }),
        toggle: (id = 'same-id') => useMobileTaskStore.getState().toggleTask(id),
        flush: () => useMobileTaskStore.getState().flushPendingCompletions(),
        xp: () => useMobileGameStore.getState().character.totalXp, stats: () => useMobileStatsStore.getState().taskXpLog },
];

describe.each(clients)('$nameの完了待機とアカウント境界（実ストア）', (client) => {
    it.each([
        { seeded: false, next: 'logout' }, { seeded: true, next: 'logout' },
        { seeded: false, next: 'switch' }, { seeded: true, next: 'switch' },
    ])('$seeded / $nextでは旧5秒タイマーとflushが別タスクを確定しない', async ({ seeded, next }) => {
        client.register(); await notifyLogin('a');
        if (seeded) client.mark();
        client.toggle();
        expect(client.get().pendingCompletions).toHaveLength(1);
        if (next === 'logout') await notifyLogout(); else await notifyLogin('b');
        expect(client.get().pendingCompletions).toEqual([]);
        const replacement = task();
        client.setTasks([replacement]);
        client.flush();
        await vi.advanceTimersByTimeAsync(5000); await vi.dynamicImportSettled();
        expect(client.get().tasks).toEqual([replacement]);
        expect(client.xp()).toBe(0);
        expect(client.stats()).toEqual({});
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('前段のasyncライフサイクルフック待機中でも即座に旧完了待ちを無効化する', async () => {
        const gate = deferred();
        registerAuthLifecycleHooks({ onLogin: (id) => id === 'b' ? gate.promise : undefined });
        client.register(); await notifyLogin('a'); client.toggle();
        const transition = notifyLogin('b');
        expect(client.get().pendingCompletions).toEqual([]);
        client.flush();
        await vi.advanceTimersByTimeAsync(5000); await vi.dynamicImportSettled();
        expect(client.xp()).toBe(0); expect(enqueue).not.toHaveBeenCalled();
        gate.resolve(); await transition;
    });

    it('未seedでも未確定の完了表示だけ取り消し、既存タスクは消さない', async () => {
        client.register(); await notifyLogin('a'); client.toggle(); await notifyLogout();
        expect(client.get().tasks).toHaveLength(1);
        expect(client.get().tasks[0]).toMatchObject({ id: 'same-id', completed: false, completedAt: null });
    });

    it('初回anonymous→ログインと同一ユーザー再通知では待機を維持する', async () => {
        client.register(); client.toggle();
        const pending = client.get().pendingCompletions[0];
        await notifyLogin('a'); await notifyLogin('a');
        expect(client.get().pendingCompletions[0]).toBe(pending);
        await vi.advanceTimersByTimeAsync(5000); await vi.dynamicImportSettled();
        expect(client.xp()).toBeGreaterThan(0);
        expect(enqueue).toHaveBeenCalledExactlyOnceWith('complete_task', { taskId: 'same-id' }, { dependsOnEntityIds: ['same-id'] });
    });

    it('A→logout→Aで旧タイマーは同IDの新しい待機を確定しない', async () => {
        client.register(); await notifyLogin('a'); client.toggle();
        await vi.advanceTimersByTimeAsync(1000);
        await notifyLogout(); await notifyLogin('a');
        client.setTasks([task()]); client.toggle();
        await vi.advanceTimersByTimeAsync(4000); await vi.dynamicImportSettled();
        expect(client.get().pendingCompletions).toHaveLength(1); expect(client.xp()).toBe(0);
        await vi.advanceTimersByTimeAsync(1000); await vi.dynamicImportSettled();
        expect(client.get().pendingCompletions).toEqual([]); expect(client.xp()).toBeGreaterThan(0);
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('ストア直接クリアでもタイマーを破棄する', async () => {
        client.toggle(); client.clear();
        expect(client.get().pendingCompletions).toEqual([]);
        client.setTasks([task()]); client.flush();
        await vi.advanceTimersByTimeAsync(5000); await vi.dynamicImportSettled();
        expect(client.get().tasks[0].completed).toBe(false); expect(enqueue).not.toHaveBeenCalled();
    });

    it('pendingと異なる時刻の最新タスク表示は巻き戻さない', async () => {
        client.register(); await notifyLogin('a'); client.toggle();
        const latest = { ...task(), completed: true, completedAt: '2026-10-17T03:00:01.000Z' };
        client.setTasks([latest]); await notifyLogout();
        expect(client.get().tasks).toEqual([latest]); expect(client.get().pendingCompletions).toEqual([]);
    });
});

describe('Webの非同期待機', () => {
    it('旧ロックの遅延失敗を新スコープのエラー表示へ上書きしない', async () => {
        const gate = deferred();
        vi.stubGlobal('navigator', { locks: { request: async () => { await gate.promise; throw new Error('old failure'); } } });
        const pending = useGameStore.getState().grantCompletionReward('task:old', 20, getCompletionRewardGeneration());
        await notifyLogin('b');
        useGameStore.setState({ completionRewardError: 'new scope message' });
        gate.resolve(); await expect(pending).resolves.toBe(false);
        expect(useGameStore.getState().completionRewardError).toBe('new scope message');
    });

    it('ロック待ち中に認証が変わった匿名報酬は保存も表示もしない', async () => {
        const gate = deferred();
        vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => unknown) => { await gate.promise; return work(); } } });
        const pending = useGameStore.getState().grantCompletionReward('task:old', 20, getCompletionRewardGeneration());
        await notifyLogin('a'); await notifyLogout();
        gate.resolve();
        await expect(pending).resolves.toBe(false);
        expect(useGameStore.getState().character.totalXp).toBe(0);
        expect(useGameStore.getState().completionRewardKeys).toEqual([]);
    });

    it('確定開始後のawait中に切り替わっても旧RPCや繰り返しを新スコープへ送らない', async () => {
        const gate = deferred();
        registerWebAuthStoreHooks(); await notifyLogin('a');
        vi.spyOn(useGameStore.getState(), 'grantCompletionReward').mockImplementation(async () => { await gate.promise; return true; });
        useTaskStore.getState().toggleComplete('same-id');
        await vi.advanceTimersByTimeAsync(5000);
        await notifyLogin('b');
        const replacement = task('b'); useTaskStore.setState({ tasks: [replacement] });
        gate.resolve(); await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0);
        expect(useTaskStore.getState().tasks).toEqual([replacement]);
        expect(useStatsStore.getState().taskXpLog).toEqual({}); expect(enqueue).not.toHaveBeenCalled();
    });
});

it('Mobileの報酬処理中に同期的な認証変更が起きても統計・繰り返し・送信を続けない', async () => {
    registerMobileAuthStoreHooks(); await notifyLogin('a');
    vi.spyOn(useMobileGameStore.getState(), 'grantTaskCompletionReward').mockImplementation(() => {
        void notifyLogin('b'); return true;
    });
    useMobileTaskStore.getState().toggleTask('same-id');
    await vi.advanceTimersByTimeAsync(5000);
    expect(useMobileStatsStore.getState().taskXpLog).toEqual({});
    expect(useMobileTaskStore.getState().tasks).toHaveLength(1); expect(enqueue).not.toHaveBeenCalled();
});
