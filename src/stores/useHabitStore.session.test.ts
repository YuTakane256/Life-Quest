import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
const releases: Array<() => void> = [];
const DATE = '2026-10-15';

async function harness(hold?: 'stats' | 'game') {
    vi.resetModules();
    localStorage.clear();
    const entered = deferred<void>();
    const gate = deferred<void>();
    releases.push(() => gate.resolve());
    const log = vi.fn();
    const addXp = vi.fn();
    const count = vi.fn();
    const milestones = vi.fn();
    const enqueue = vi.fn(async (_operation: string, _payload: unknown, _options: unknown) => true);
    vi.doMock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: enqueue }));
    vi.doMock('./useStatsStore', async () => {
        if (hold === 'stats') { entered.resolve(); await gate.promise; }
        return { useStatsStore: { getState: () => ({ logHabitActivity: log }) } };
    });
    vi.doMock('./useGameStore', async () => {
        if (hold === 'game') { entered.resolve(); await gate.promise; }
        return { useGameStore: { getState: () => ({ addXp, incrementGachaCount: count, checkGachaMilestones: milestones }) } };
    });
    const auth = await import('@life-quest/core/authLifecycle');
    const { useHabitStore: store } = await import('./useHabitStore');
    await auth.notifyLogin('a');
    store.setState({ habits: [{ id: 'a-habit', name: 'A', categoryId: 'health', createdAt: `${DATE}T00:00:00Z` }],
        dailyRecords: [], restDays: [], allCompleteRewardDates: [] });
    const seedB = () => store.setState({
        habits: [{ id: 'b-habit', name: 'B', categoryId: 'health', createdAt: `${DATE}T00:00:00Z` }],
        dailyRecords: [{ habitId: 'b-habit', date: DATE, completed: true, memo: '' }],
        allCompleteRewardDates: [],
    });
    return { store, auth, seedB, entered, gate, log, addXp, count, milestones, enqueue };
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
    for (const release of releases.splice(0)) release();
    await vi.dynamicImportSettled();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.doUnmock('../platform/cloudOutbox');
    vi.doUnmock('./useStatsStore');
    vi.doUnmock('./useGameStore');
});

describe('Web habit deferred effects / session isolation', () => {
    it.each(['same-user', 'anonymous'] as const)('keeps normal once-per-day rewards after duplicate %s notifications', async (scope) => {
        const h = await harness();
        if (scope === 'anonymous') await h.auth.notifyLogout();
        h.store.getState().toggleHabitCompletion('a-habit', DATE);
        if (scope === 'same-user') await h.auth.notifyLogin('a');
        else await h.auth.notifyLogout();
        await vi.runOnlyPendingTimersAsync();
        await vi.dynamicImportSettled();
        expect(h.log).toHaveBeenCalledWith(DATE, 1, true);
        expect(h.addXp).toHaveBeenCalledTimes(1);
        expect(h.count).toHaveBeenCalledTimes(1);
        expect(h.store.getState().allCompleteRewardDates).toEqual([DATE]);
        h.store.getState().toggleHabitCompletion('a-habit', DATE);
        h.store.getState().toggleHabitCompletion('a-habit', DATE);
        await vi.runOnlyPendingTimersAsync();
        await vi.dynamicImportSettled();
        expect(h.addXp).toHaveBeenCalledTimes(1);
        expect(h.enqueue.mock.calls.filter(([operation]) => operation === 'claim_habit_bonus')).toHaveLength(1);
    });

    it('does not revive A work when A→B→A happens before the timer', async () => {
        const h = await harness();
        h.store.getState().toggleHabitCompletion('a-habit', DATE);
        await h.auth.notifyLogin('b');
        await h.auth.notifyLogin('a');
        await vi.runOnlyPendingTimersAsync();
        await vi.dynamicImportSettled();
        expect(h.log).not.toHaveBeenCalled();
        expect(h.addXp).not.toHaveBeenCalled();
    });

    it('does not consume an unpaid reward date while the game module is still loading', async () => {
        const h = await harness('game');
        h.store.getState().toggleHabitCompletion('a-habit', DATE);
        vi.runOnlyPendingTimers();
        await h.entered.promise;
        expect(h.store.getState().allCompleteRewardDates).toEqual([]);
        await h.auth.notifyLogout(); // Unseeded local data need not be cleared on logout.
        h.gate.resolve();
        await vi.dynamicImportSettled();
        expect(h.store.getState().allCompleteRewardDates).toEqual([]);
        expect(h.addXp).not.toHaveBeenCalled();
    });

    it.each(['logout', 'switch'] as const)('does not inspect another session after %s before the timer runs', async (transition) => {
        const h = await harness();
        h.store.getState().toggleHabitCompletion('a-habit', DATE);
        if (transition === 'logout') await h.auth.notifyLogout();
        else await h.auth.notifyLogin('b');
        h.seedB();
        await vi.runOnlyPendingTimersAsync();
        await vi.dynamicImportSettled();
        expect(h.log).not.toHaveBeenCalled();
        expect(h.addXp).not.toHaveBeenCalled();
        expect(h.store.getState().allCompleteRewardDates).toEqual([]);
        expect(h.enqueue.mock.calls.map(([operation]) => operation)).toEqual(['set_habit_log']);
    });

    it.each(['stats', 'game'] as const)('rechecks the session after awaiting the %s module', async (hold) => {
        const h = await harness(hold);
        h.store.getState().toggleHabitCompletion('a-habit', DATE);
        vi.runOnlyPendingTimers();
        await h.entered.promise;
        await h.auth.notifyLogin('b');
        h.seedB();
        h.gate.resolve();
        await vi.dynamicImportSettled();
        if (hold === 'stats') expect(h.log).not.toHaveBeenCalled();
        else expect(h.log).toHaveBeenCalledTimes(1); // A's completed stats before the switch remain legitimate.
        expect(h.addXp).not.toHaveBeenCalled();
        expect(h.count).not.toHaveBeenCalled();
        expect(h.milestones).not.toHaveBeenCalled();
        expect(h.store.getState().allCompleteRewardDates).toEqual([]);
        expect(h.enqueue.mock.calls.map(([operation]) => operation)).toEqual(['set_habit_log']);
    });

    it('does not enqueue A bonus into B after waiting for the habit log', async () => {
        const h = await harness();
        const log = deferred<boolean>();
        h.enqueue.mockReturnValueOnce(log.promise);
        h.store.getState().toggleHabitCompletion('a-habit', DATE);
        vi.runOnlyPendingTimers();
        await vi.dynamicImportSettled();
        expect(h.addXp).toHaveBeenCalledTimes(1); // A reward was applied before the switch.
        await h.auth.notifyLogin('b');
        h.seedB();
        log.resolve(true);
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(h.enqueue.mock.calls.map(([operation]) => operation)).toEqual(['set_habit_log']);
    });
});
