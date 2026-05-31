import { beforeEach, describe, expect, it } from 'vitest';
import { useStatsStore } from './useStatsStore';

function resetStore() {
    localStorage.clear();
    useStatsStore.setState({ taskXpLog: {}, habitLog: {} });
}

describe('useStatsStore', () => {
    beforeEach(() => {
        resetStore();
    });

    describe('logTaskXp', () => {
        it('新規日付に最初のログを書く', () => {
            useStatsStore.getState().logTaskXp('2025-03-15', 30);
            expect(useStatsStore.getState().taskXpLog).toEqual({ '2025-03-15': 30 });
        });

        it('同日複数回呼び出すと累積する', () => {
            useStatsStore.getState().logTaskXp('2025-03-15', 10);
            useStatsStore.getState().logTaskXp('2025-03-15', 20);
            useStatsStore.getState().logTaskXp('2025-03-15', 5);
            expect(useStatsStore.getState().taskXpLog['2025-03-15']).toBe(35);
        });

        it('異なる日付は独立して累積する', () => {
            useStatsStore.getState().logTaskXp('2025-03-15', 30);
            useStatsStore.getState().logTaskXp('2025-03-16', 50);
            useStatsStore.getState().logTaskXp('2025-03-15', 20);
            const log = useStatsStore.getState().taskXpLog;
            expect(log['2025-03-15']).toBe(50);
            expect(log['2025-03-16']).toBe(50);
        });

        it('0 XP のログでも日付エントリーは作られる', () => {
            useStatsStore.getState().logTaskXp('2025-03-15', 0);
            expect('2025-03-15' in useStatsStore.getState().taskXpLog).toBe(true);
            expect(useStatsStore.getState().taskXpLog['2025-03-15']).toBe(0);
        });
    });

    describe('logHabitActivity', () => {
        it('新規日付にエントリーを書く', () => {
            useStatsStore.getState().logHabitActivity('2025-03-15', 3, false);
            expect(useStatsStore.getState().habitLog['2025-03-15']).toEqual({ count: 3, allComplete: false });
        });

        it('同日呼び出しは後勝ち（上書き）', () => {
            useStatsStore.getState().logHabitActivity('2025-03-15', 1, false);
            useStatsStore.getState().logHabitActivity('2025-03-15', 5, true);
            expect(useStatsStore.getState().habitLog['2025-03-15']).toEqual({ count: 5, allComplete: true });
        });

        it('allComplete: true → false の上書きも可能', () => {
            useStatsStore.getState().logHabitActivity('2025-03-15', 5, true);
            useStatsStore.getState().logHabitActivity('2025-03-15', 4, false);
            expect(useStatsStore.getState().habitLog['2025-03-15'].allComplete).toBe(false);
        });

        it('異なる日付は独立', () => {
            useStatsStore.getState().logHabitActivity('2025-03-15', 3, true);
            useStatsStore.getState().logHabitActivity('2025-03-16', 5, false);
            const log = useStatsStore.getState().habitLog;
            expect(log['2025-03-15']).toEqual({ count: 3, allComplete: true });
            expect(log['2025-03-16']).toEqual({ count: 5, allComplete: false });
        });
    });

    describe('persistence', () => {
        it('logTaskXp 後に localStorage に taskXpLog が反映される', () => {
            useStatsStore.getState().logTaskXp('2025-03-15', 42);
            const raw = localStorage.getItem('quest-board-stats');
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw!);
            // zustand persist は { state: {...}, version: ... } という構造
            expect(parsed.state.taskXpLog).toEqual({ '2025-03-15': 42 });
        });

        it('logHabitActivity 後に localStorage に habitLog が反映される', () => {
            useStatsStore.getState().logHabitActivity('2025-03-15', 3, true);
            const raw = localStorage.getItem('quest-board-stats');
            const parsed = JSON.parse(raw!);
            expect(parsed.state.habitLog['2025-03-15']).toEqual({ count: 3, allComplete: true });
        });
    });
});
