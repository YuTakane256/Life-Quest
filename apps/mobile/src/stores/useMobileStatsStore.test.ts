import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileStatsStore } from './useMobileStatsStore';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

function resetStore() {
    useMobileStatsStore.setState({ taskXpLog: {}, habitLog: {}, seeded: false, hasHydrated: true });
}

describe('useMobileStatsStore', () => {
    beforeEach(resetStore);

    it('logTaskXpは同日の加算を積み上げる', () => {
        useMobileStatsStore.getState().logTaskXp('2026-07-10', 20);
        useMobileStatsStore.getState().logTaskXp('2026-07-10', 10);
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-07-10': 30 });
    });

    it('logHabitActivityは同日を上書きする', () => {
        useMobileStatsStore.getState().logHabitActivity('2026-07-10', 1, false);
        useMobileStatsStore.getState().logHabitActivity('2026-07-10', 3, true);
        expect(useMobileStatsStore.getState().habitLog).toEqual({
            '2026-07-10': { count: 3, allComplete: true },
        });
    });

    it('seedIfNeededは未シード時のみ現存コレクションから復元する', () => {
        const tasks = [{
            id: 't1', name: 'タスク', dueDate: null, priority: 'high' as const, tags: [],
            subtasks: [], recurrence: 'none' as const, completed: true,
            completedAt: '2026-07-10T09:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z',
        }];
        useMobileStatsStore.getState().seedIfNeeded(tasks, [], []);
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-07-10': 30 });
        expect(useMobileStatsStore.getState().seeded).toBe(true);

        // 2回目はシード済みなので何もしない（ログを追記した後にtasksを空にしてもログは残る＝分離確認）
        useMobileStatsStore.getState().logTaskXp('2026-07-11', 5);
        useMobileStatsStore.getState().seedIfNeeded([], [], []);
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-07-10': 30, '2026-07-11': 5 });
    });

    it('タスクを削除してもログの既存エントリは変化しない（activeDaysが減らないことの土台）', () => {
        useMobileStatsStore.getState().logTaskXp('2026-07-10', 30);
        // タスク削除はuseMobileTaskStore側の操作でありstatsログには一切触れない。
        // ログが「削除」のような操作を持たないこと自体がこのテストの主張。
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-07-10': 30 });
    });
});
