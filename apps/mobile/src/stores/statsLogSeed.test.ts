import { beforeEach, describe, expect, it, vi } from 'vitest';
import { XP_CONFIG } from '@life-quest/core/progression';
import { startStatsLogSeed } from './statsLogSeed';
import { useMobileHabitStore } from './useMobileHabitStore';
import { useMobileStatsStore } from './useMobileStatsStore';
import { useMobileTaskStore } from './useMobileTaskStore';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

function resetAll() {
    useMobileStatsStore.setState({ taskXpLog: {}, habitLog: {}, seeded: false, hasHydrated: false });
    useMobileTaskStore.setState({ tasks: [], pendingCompletions: [], hasHydrated: false });
    useMobileHabitStore.setState({ habits: [], records: [], restDays: [], rewardEligibleDates: [], hasHydrated: false });
}

describe('startStatsLogSeed', () => {
    beforeEach(resetAll);

    it('全ストアがhydration済みになった時点で一度だけシードする', () => {
        useMobileTaskStore.setState({
            tasks: [{
                id: 't1', name: 'タスク', dueDate: null, priority: 'high', tags: [], subtasks: [],
                recurrence: 'none', completed: true, completedAt: '2026-07-10T09:00:00.000Z',
                createdAt: '2026-07-01T00:00:00.000Z',
            }],
        });

        const unsubscribe = startStatsLogSeed();
        // タスクだけhydration済みでは、他ストアが未済のためシードされない
        useMobileTaskStore.setState({ hasHydrated: true });
        expect(useMobileStatsStore.getState().seeded).toBe(false);

        useMobileHabitStore.setState({ hasHydrated: true });
        useMobileStatsStore.setState({ hasHydrated: true });

        expect(useMobileStatsStore.getState().seeded).toBe(true);
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-07-10': XP_CONFIG.REWARD_BY_PRIORITY.high });

        unsubscribe();
    });

    it('既にシード済みなら再実行しても上書きしない', () => {
        useMobileStatsStore.setState({
            taskXpLog: { '2026-07-01': 999 },
            habitLog: {},
            seeded: true,
            hasHydrated: true,
        });
        useMobileTaskStore.setState({ hasHydrated: true });
        useMobileHabitStore.setState({ hasHydrated: true });

        const unsubscribe = startStatsLogSeed();

        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-07-01': 999 });
        unsubscribe();
    });
});
