import { describe, expect, it } from 'vitest';
import {
    buildHabitActivityByDate,
    buildTaskXpByDate,
    generateDateRange,
    getHabitHeatmapLevel,
    getMonthLabels,
    getTaskHeatmapLevel,
    groupDatesByWeeks,
} from './stats';
import { createHabit } from './habits';
import type { Task } from './tasks';

describe('ヒートマップ濃淡レベル', () => {
    it.each([
        [0, 0], [1, 1], [15, 1], [16, 2], [30, 2], [31, 3], [50, 3], [51, 4], [9999, 4],
    ])('タスク xp=%i → level=%i', (xp, level) => {
        expect(getTaskHeatmapLevel(xp)).toBe(level);
    });

    it('習慣は全達成で常に4、達成数で1-3', () => {
        expect(getHabitHeatmapLevel(1, true)).toBe(4);
        expect(getHabitHeatmapLevel(0, false)).toBe(0);
        expect(getHabitHeatmapLevel(1, false)).toBe(1);
        expect(getHabitHeatmapLevel(3, false)).toBe(2);
        expect(getHabitHeatmapLevel(4, false)).toBe(3);
    });
});

describe('日付グリッド', () => {
    it('generateDateRange は today で終わる昇順の日付列を返す', () => {
        expect(generateDateRange(3, '2026-07-03')).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
        expect(generateDateRange(2, '2026-01-01')).toEqual(['2025-12-31', '2026-01-01']);
    });

    it('groupDatesByWeeks は日曜始まりでパディングし、各週7要素にする', () => {
        // 2026-07-01 は水曜 (weekday 3)
        const weeks = groupDatesByWeeks(generateDateRange(10, '2026-07-10'));
        expect(weeks[0]).toHaveLength(7);
        expect(weeks[0].slice(0, 3)).toEqual(['', '', '']);
        expect(weeks[0][3]).toBe('2026-07-01');
        const flat = weeks.flat().filter((date) => date !== '');
        expect(flat).toHaveLength(10);
        weeks.forEach((week) => expect(week).toHaveLength(7));
    });

    it('getMonthLabels は月の変わり目にラベルを付ける', () => {
        const weeks = groupDatesByWeeks(generateDateRange(14, '2026-08-05'));
        const labels = getMonthLabels(weeks);
        expect(labels.map((label) => label.label)).toEqual(['7月', '8月']);
    });
});

function task(overrides: Partial<Task>): Task {
    return {
        id: 't1', name: 'x', dueDate: null, priority: 'medium', tags: [], subtasks: [],
        recurrence: 'none', completed: false, completedAt: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('buildTaskXpByDate', () => {
    it('完了タスクの優先度XPと完了サブタスクXPをJST日付で集計する', () => {
        const tasks = [
            // UTC 16:00 = JST 翌日01:00 → 2026-07-02 に計上
            task({ id: 't1', priority: 'high', completed: true, completedAt: '2026-07-01T16:00:00.000Z' }),
            task({
                id: 't2', priority: 'medium', completed: false,
                subtasks: [
                    { id: 's1', name: 'a', completed: true, completedAt: '2026-07-01T01:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z' },
                    { id: 's2', name: 'b', completed: false, completedAt: null, createdAt: '2026-07-01T00:00:00.000Z' },
                ],
            }),
        ];

        expect(buildTaskXpByDate(tasks)).toEqual({
            '2026-07-02': 30, // high
            '2026-07-01': 10, // medium の半分
        });
    });

    it('不正な completedAt は無視する', () => {
        const tasks = [task({ completed: true, completedAt: 'not-a-date' })];
        expect(buildTaskXpByDate(tasks)).toEqual({});
    });
});

describe('buildHabitActivityByDate', () => {
    it('日付ごとの達成数と全達成フラグを返す', () => {
        const habits = [
            createHabit('h1', '運動', 'health', '2026-06-01T00:00:00.000Z')!,
            createHabit('h2', '読書', 'study', '2026-06-01T00:00:00.000Z')!,
        ];
        const records = [
            { habitId: 'h1', date: '2026-07-01', completed: true, memo: '' },
            { habitId: 'h2', date: '2026-07-01', completed: true, memo: '' },
            { habitId: 'h1', date: '2026-07-02', completed: true, memo: '' },
            { habitId: 'h2', date: '2026-07-02', completed: false, memo: '' },
        ];

        expect(buildHabitActivityByDate(habits, records)).toEqual({
            '2026-07-01': { count: 2, allComplete: true },
            '2026-07-02': { count: 1, allComplete: false },
        });
    });

    it('レコードが無ければ空を返す', () => {
        expect(buildHabitActivityByDate([], [])).toEqual({});
    });
});
