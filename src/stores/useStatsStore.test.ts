import { beforeEach, describe, expect, it } from 'vitest';
import { useStatsStore } from './useStatsStore';

function reset() {
    localStorage.clear();
    useStatsStore.setState({ taskXpLog: {}, habitLog: {} });
}

describe('useStatsStore', () => {
    beforeEach(() => reset());

    // ── logTaskXp ──
    describe('logTaskXp', () => {
        it('新規日付に最初の log', () => {
            useStatsStore.getState().logTaskXp('2025-03-15', 30);
            expect(useStatsStore.getState().taskXpLog['2025-03-15']).toBe(30);
        });

        it('同日複数回呼び出しで累積される', () => {
            useStatsStore.getState().logTaskXp('2025-03-15', 10);
            useStatsStore.getState().logTaskXp('2025-03-15', 20);
            expect(useStatsStore.getState().taskXpLog['2025-03-15']).toBe(30);
        });

        it('0 XP でも日付エントリーが作られる', () => {
            useStatsStore.getState().logTaskXp('2025-03-15', 0);
            expect(useStatsStore.getState().taskXpLog).toHaveProperty('2025-03-15');
            expect(useStatsStore.getState().taskXpLog['2025-03-15']).toBe(0);
        });

        it('異なる日付は独立して累積', () => {
            useStatsStore.getState().logTaskXp('2025-03-15', 10);
            useStatsStore.getState().logTaskXp('2025-03-16', 20);
            expect(useStatsStore.getState().taskXpLog['2025-03-15']).toBe(10);
            expect(useStatsStore.getState().taskXpLog['2025-03-16']).toBe(20);
        });
    });

    // ── logHabitActivity ──
    describe('logHabitActivity', () => {
        it('新規日付にデータがセットされる', () => {
            useStatsStore.getState().logHabitActivity('2025-03-15', 3, false);
            expect(useStatsStore.getState().habitLog['2025-03-15']).toEqual({ count: 3, allComplete: false });
        });

        it('同日の上書きは後勝ち', () => {
            useStatsStore.getState().logHabitActivity('2025-03-15', 2, false);
            useStatsStore.getState().logHabitActivity('2025-03-15', 5, true);
            expect(useStatsStore.getState().habitLog['2025-03-15']).toEqual({ count: 5, allComplete: true });
        });

        it('allComplete: true → false への上書きも可能', () => {
            useStatsStore.getState().logHabitActivity('2025-03-15', 5, true);
            useStatsStore.getState().logHabitActivity('2025-03-15', 4, false);
            expect(useStatsStore.getState().habitLog['2025-03-15']).toEqual({ count: 4, allComplete: false });
        });

        it('異なる日付は独立', () => {
            useStatsStore.getState().logHabitActivity('2025-03-15', 1, false);
            useStatsStore.getState().logHabitActivity('2025-03-16', 3, true);
            expect(useStatsStore.getState().habitLog['2025-03-15']).toEqual({ count: 1, allComplete: false });
            expect(useStatsStore.getState().habitLog['2025-03-16']).toEqual({ count: 3, allComplete: true });
        });
    });

    // ── localStorage 永続化確認 ──
    describe('永続化', () => {
        it('taskXpLog と habitLog が localStorage に保存される', () => {
            useStatsStore.getState().logTaskXp('2025-03-15', 42);
            useStatsStore.getState().logHabitActivity('2025-03-15', 2, true);

            const stored = JSON.parse(localStorage.getItem('quest-board-stats') || '{}');
            expect(stored.state.taskXpLog['2025-03-15']).toBe(42);
            expect(stored.state.habitLog['2025-03-15']).toEqual({ count: 2, allComplete: true });
        });
    });
});
