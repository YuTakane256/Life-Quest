import { describe, expect, it } from 'vitest';
import {
    appendHabitActivity,
    appendTaskXp,
    keepRecentEntries,
    MAX_STATS_DAILY_VALUE,
    MAX_STATS_LOG_ENTRIES,
    sanitizeHabitLog,
    sanitizeTaskXpLog,
    seedStatsLogFromCollections,
} from './statsLog.ts';
import type { Task } from './tasks.ts';
import type { Habit, HabitDailyRecord } from './habits.ts';

describe('sanitizeTaskXpLog', () => {
    it('有効な日付キーと0以上の整数だけを残す', () => {
        expect(sanitizeTaskXpLog({
            '2026-06-13': 12.8,
            '2026-06-14': 0,
            '2026-6-15': 20,
            '2026-06-16': -1,
            '2026-06-17': Number.NaN,
            other: 99,
        })).toEqual({
            '2026-06-13': 12,
            '2026-06-14': 0,
        });
    });

    it('非オブジェクトは空ログを返す', () => {
        expect(sanitizeTaskXpLog(null)).toEqual({});
        expect(sanitizeTaskXpLog('x')).toEqual({});
    });
});

describe('sanitizeHabitLog', () => {
    it('countとallCompleteが正しいエントリだけを残す', () => {
        expect(sanitizeHabitLog({
            '2026-06-13': { count: 2.9, allComplete: true },
            '2026-06-14': { count: 0, allComplete: false },
            '2026-06-15': { count: -1, allComplete: true },
            '2026-06-16': { count: 2, allComplete: 'yes' },
            bad: { count: 3, allComplete: true },
        })).toEqual({
            '2026-06-13': { count: 2, allComplete: true },
            '2026-06-14': { count: 0, allComplete: false },
        });
    });
});

describe('keepRecentEntries', () => {
    it('上限以下ならそのまま返す', () => {
        const log = { '2026-01-01': 1, '2026-01-02': 2 };
        expect(keepRecentEntries(log)).toBe(log);
    });

    it('上限を超えたら新しい日付から上限件数だけ残す', () => {
        const log: Record<string, number> = {};
        for (let i = 0; i < MAX_STATS_LOG_ENTRIES + 5; i++) {
            const date = new Date(2020, 0, 1 + i).toISOString().slice(0, 10);
            log[date] = i;
        }
        const result = keepRecentEntries(log);
        expect(Object.keys(result)).toHaveLength(MAX_STATS_LOG_ENTRIES);
        // 最も新しい日付が残っていること
        const dates = Object.keys(result).sort();
        const sourceDates = Object.keys(log).sort();
        expect(dates[dates.length - 1]).toBe(sourceDates[sourceDates.length - 1]);
    });
});

describe('appendTaskXp', () => {
    it('同じ日への加算は積み上がる', () => {
        let log = appendTaskXp({}, '2026-07-10', 10);
        log = appendTaskXp(log, '2026-07-10', 5);
        expect(log).toEqual({ '2026-07-10': 15 });
    });

    it('不正な日付・負のXPは無視する', () => {
        expect(appendTaskXp({}, 'bad-date', 10)).toEqual({});
        expect(appendTaskXp({}, '2026-07-10', -1)).toEqual({});
    });

    it('MAX_STATS_DAILY_VALUEで飽和する', () => {
        const log = appendTaskXp({ '2026-07-10': MAX_STATS_DAILY_VALUE }, '2026-07-10', 100);
        expect(log['2026-07-10']).toBe(MAX_STATS_DAILY_VALUE);
    });
});

describe('appendHabitActivity', () => {
    it('指定日のエントリを上書きする（Webと同一の挙動）', () => {
        let log = appendHabitActivity({}, '2026-07-10', 2, false);
        log = appendHabitActivity(log, '2026-07-10', 3, true);
        expect(log).toEqual({ '2026-07-10': { count: 3, allComplete: true } });
    });

    it('不正な日付・countは無視する', () => {
        expect(appendHabitActivity({}, 'bad', 1, true)).toEqual({});
        expect(appendHabitActivity({}, '2026-07-10', -1, true)).toEqual({});
    });
});

describe('seedStatsLogFromCollections', () => {
    function task(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
        return {
            name: `task-${overrides.id}`,
            dueDate: null,
            priority: 'medium',
            tags: [],
            subtasks: [],
            recurrence: 'none',
            completed: false,
            completedAt: null,
            createdAt: '2026-07-01T00:00:00.000Z',
            ...overrides,
        };
    }

    function habit(overrides: Partial<Habit> & Pick<Habit, 'id'>): Habit {
        return { name: `habit-${overrides.id}`, categoryId: 'other', createdAt: '2026-07-01T00:00:00.000Z', ...overrides };
    }

    it('現存するtasks/habits/recordsから統計ログを再構築する', () => {
        const tasks: Task[] = [
            task({ id: 't1', completed: true, completedAt: '2026-07-10T09:00:00.000Z', priority: 'high' }),
        ];
        const habits: Habit[] = [habit({ id: 'h1' })];
        const records: HabitDailyRecord[] = [
            { habitId: 'h1', date: '2026-07-10', completed: true, memo: '' },
        ];

        const result = seedStatsLogFromCollections(tasks, habits, records);
        expect(result.taskXpLog).toEqual({ '2026-07-10': 30 }); // high優先度のXP報酬額
        expect(result.habitLog).toEqual({ '2026-07-10': { count: 1, allComplete: true } });
    });

    it('データが無ければ空ログを返す', () => {
        expect(seedStatsLogFromCollections([], [], [])).toEqual({ taskXpLog: {}, habitLog: {} });
    });
});
