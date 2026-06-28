import { beforeEach, describe, expect, it } from 'vitest';
import {
    MAX_STATS_DAILY_VALUE,
    MAX_STATS_LOG_ENTRIES,
    sanitizeStatsStoreState,
    useStatsStore,
} from './useStatsStore';
import { shiftDate } from '../utils/dateUtils';

function reset() {
    localStorage.clear();
    useStatsStore.setState({ taskXpLog: {}, habitLog: {} });
}

describe('useStatsStore', () => {
    beforeEach(() => reset());

    describe('sanitizeStatsStoreState', () => {
        it('非オブジェクトの永続化データは空ログにする', () => {
            expect(sanitizeStatsStoreState(null)).toEqual({
                taskXpLog: {},
                habitLog: {},
            });
        });

        it('taskXpLog は有効な日付キーと0以上の有限数だけを残す', () => {
            expect(
                sanitizeStatsStoreState({
                    taskXpLog: {
                        '2026-06-13': 12.8,
                        '2026-06-14': 0,
                        '2026-6-15': 20,
                        '2026-06-16': -1,
                        '2026-06-17': Number.NaN,
                        other: 99,
                    },
                }).taskXpLog
            ).toEqual({
                '2026-06-13': 12,
                '2026-06-14': 0,
            });
        });

        it('habitLog は count と allComplete が正しいエントリだけを残す', () => {
            expect(
                sanitizeStatsStoreState({
                    habitLog: {
                        '2026-06-13': { count: 2.9, allComplete: true },
                        '2026-06-14': { count: 0, allComplete: false },
                        '2026-06-15': { count: -1, allComplete: true },
                        '2026-06-16': { count: 2, allComplete: 'yes' },
                        bad: { count: 3, allComplete: true },
                    },
                }).habitLog
            ).toEqual({
                '2026-06-13': { count: 2, allComplete: true },
                '2026-06-14': { count: 0, allComplete: false },
            });
        });

        it('各ログは最新10年分を残し、巨大値は安全整数上限へ丸める', () => {
            const dates = Array.from(
                { length: MAX_STATS_LOG_ENTRIES + 1 },
                (_, index) => shiftDate('2026-12-31', -index),
            );
            const sanitized = sanitizeStatsStoreState({
                taskXpLog: Object.fromEntries(dates.map((date) => [date, Number.MAX_VALUE])),
                habitLog: Object.fromEntries(dates.map((date) => [date, {
                    count: Number.MAX_VALUE,
                    allComplete: false,
                }])),
            });

            expect(Object.keys(sanitized.taskXpLog)).toHaveLength(MAX_STATS_LOG_ENTRIES);
            expect(Object.keys(sanitized.habitLog)).toHaveLength(MAX_STATS_LOG_ENTRIES);
            expect(sanitized.taskXpLog['2026-12-31']).toBe(MAX_STATS_DAILY_VALUE);
            expect(sanitized.habitLog['2026-12-31'].count).toBe(MAX_STATS_DAILY_VALUE);
            expect(sanitized.taskXpLog[dates[dates.length - 1]]).toBeUndefined();
        });
    });

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

        it('不正な日付やXPは記録しない', () => {
            useStatsStore.getState().logTaskXp('2025-02-29', 10);
            useStatsStore.getState().logTaskXp('2025-03-15', -1);
            useStatsStore.getState().logTaskXp('2025-03-16', Number.NaN);
            expect(useStatsStore.getState().taskXpLog).toEqual({});
        });

        it('小数XPは整数に丸めて記録する', () => {
            useStatsStore.getState().logTaskXp('2025-03-15', 10.9);
            expect(useStatsStore.getState().taskXpLog['2025-03-15']).toBe(10);
        });

        it('同日の累積XPは安全整数上限で飽和する', () => {
            useStatsStore.setState({ taskXpLog: { '2025-03-15': MAX_STATS_DAILY_VALUE } });

            useStatsStore.getState().logTaskXp('2025-03-15', 10);

            expect(useStatsStore.getState().taskXpLog['2025-03-15']).toBe(MAX_STATS_DAILY_VALUE);
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

        it('不正な日付やcountは記録しない', () => {
            useStatsStore.getState().logHabitActivity('2025-02-29', 1, true);
            useStatsStore.getState().logHabitActivity('2025-03-15', -1, true);
            useStatsStore.getState().logHabitActivity('2025-03-16', Number.POSITIVE_INFINITY, true);
            expect(useStatsStore.getState().habitLog).toEqual({});
        });

        it('小数countは整数に丸めて記録する', () => {
            useStatsStore.getState().logHabitActivity('2025-03-15', 3.9, true);
            expect(useStatsStore.getState().habitLog['2025-03-15']).toEqual({ count: 3, allComplete: true });
        });

        it('巨大countは安全整数上限で飽和する', () => {
            useStatsStore.getState().logHabitActivity('2025-03-15', Number.MAX_VALUE, true);

            expect(useStatsStore.getState().habitLog['2025-03-15']).toEqual({
                count: MAX_STATS_DAILY_VALUE,
                allComplete: true,
            });
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
