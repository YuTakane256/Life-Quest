import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { useMobileHabitStore } from './useMobileHabitStore';
import { useMobileGameStore } from './useMobileGameStore';
import { useMobileStatsStore } from './useMobileStatsStore';
import { enqueueCloudOperation } from '../platform/cloudOutbox';
import { clearMobileCloudStores } from '../platform/authStores';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: vi.fn(async () => true) }));
vi.mock('./useMobileLoginBonusStore', () => ({ beginMobileLoginBonusCloudSession: vi.fn(), clearMobileLoginBonusCloudSession: vi.fn() }));
const enqueue = vi.mocked(enqueueCloudOperation);
const DATE = '2026-10-15';

beforeEach(async () => {
    resetAuthLifecycleHooks();
    enqueue.mockReset().mockResolvedValue(true);
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, lastLevelUp: null });
    useMobileStatsStore.setState({ taskXpLog: {}, habitLog: {}, hasHydrated: true, seeded: true });
    useMobileHabitStore.setState({ habits: [{ id: 'a-habit', name: 'A', categoryId: 'health', createdAt: `${DATE}T00:00:00Z` }],
        records: [], restDays: [], rewardEligibleDates: [], hasHydrated: true });
    await notifyLogin('a');
});
afterEach(() => resetAuthLifecycleHooks());

describe('Mobile habit deferred bonus / session isolation', () => {
    it('keeps normal claim ordering across a duplicate same-user notification', async () => {
        let release!: (value: boolean) => void;
        enqueue.mockReturnValueOnce(new Promise<boolean>((resolve) => { release = resolve; }));
        useMobileHabitStore.getState().toggleToday('a-habit', DATE);
        await notifyLogin('a');
        expect(enqueue.mock.calls.map(([operation]) => operation)).toEqual(['set_habit_log']);
        release(true);
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(enqueue.mock.calls.map(([operation]) => operation)).toEqual(['set_habit_log', 'claim_habit_bonus']);
    });

    it('does not enqueue a deferred claim after direct account-store cleanup', async () => {
        let release!: (value: boolean) => void;
        enqueue.mockReturnValueOnce(new Promise<boolean>((resolve) => { release = resolve; }));
        useMobileHabitStore.getState().toggleToday('a-habit', DATE);
        clearMobileCloudStores(); // No SDK logout notification yet.
        release(true);
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(enqueue.mock.calls.map(([operation]) => operation)).toEqual(['set_habit_log']);
        expect(useMobileGameStore.getState().character.totalXp).toBe(0);
    });

    it.each(['logout', 'switch'] as const)('does not enqueue A bonus after %s while its log is pending', async (transition) => {
        let release!: (value: boolean) => void;
        enqueue.mockReturnValueOnce(new Promise<boolean>((resolve) => { release = resolve; }));
        useMobileHabitStore.getState().toggleToday('a-habit', DATE);
        if (transition === 'logout') await notifyLogout();
        else await notifyLogin('b');
        useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, lastLevelUp: null });
        release(true);
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(enqueue.mock.calls.map(([operation]) => operation)).toEqual(['set_habit_log']);
        expect(useMobileGameStore.getState().character.totalXp).toBe(0);
    });
});
