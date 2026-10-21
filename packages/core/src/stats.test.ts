import { describe, expect, it } from 'vitest';
import {
    buildHabitActivityByDate,
    buildTaskXpByDate,
    generateDateRange,
    getHabitHeatmapLevel,
    getMonthLabels,
    getTaskHeatmapLevel,
    groupDatesByWeeks,
    STATS_DISPLAY_DAYS,
    summarizeStats,
    getStatsDayValue,
    getWeeklyTaskXp,
    getStatsBestRecords,
    formatStatsStreakRange,
} from './stats.ts';
import { msUntilNextJstDay } from './dates.ts';
import { createHabit } from './habits.ts';
import type { Task } from './tasks.ts';

describe('直近7日間XPと保存済み全期間の自己ベスト', () => {
    it('月曜日でも先週の日付を含む直近7日を返し、記録なしは0とする', () => {
        const result = getWeeklyTaskXp({ '2026-08-03': 999, '2026-08-04': 20, '2026-08-09': 35, '2026-08-10': 45, '2026-08-11': 999 }, '2026-08-10');
        expect(result.total).toBe(100); expect(result.max).toBe(45); expect(result.perDay).toHaveLength(7);
        expect(result.perDay[0]).toEqual({ date: '2026-08-04', xp: 20, weekday: '火' });
        expect(result.perDay[6]).toEqual({ date: '2026-08-10', xp: 45, weekday: '月' });
        expect(result.perDay[1].xp).toBe(0);
    });
    it('年/うるう日の境界と翌日の再集計に追従する', () => {
        expect(getWeeklyTaskXp({}, '2026-01-02').perDay[0].date).toBe('2025-12-27');
        expect(getWeeklyTaskXp({}, '2024-03-01').perDay[5]).toEqual({ date: '2024-02-29', xp: 0, weekday: '木' });
        expect(getWeeklyTaskXp({ '2026-08-04': 20 }, '2026-08-11').total).toBe(0);
    });
    it('空のグラフはゼロで、自己ベストは未記録と空の日付範囲になる', () => {
        expect(getWeeklyTaskXp({}, '2026-08-10')).toMatchObject({ total: 0, max: 0 });
        const best = getStatsBestRecords({}, {});
        expect(best).toEqual({ bestXp: 0, bestXpDate: '', longestActive: { count: 0, start: '', end: '' }, longestPerfect: { count: 0, start: '', end: '' } });
        expect(formatStatsStreakRange(best.longestActive)).toBe('');
    });
    it('119日より古い記録も自己ベストには含み、0XP/部分達成は連続を切る', () => {
        const best = getStatsBestRecords({ '2025-01-01': 100, '2025-01-02': 20, '2025-01-03': 0, '2025-01-04': 10 }, {
            '2025-01-01': { count: 2, allComplete: true }, '2025-01-02': { count: 3, allComplete: false }, '2025-01-03': { count: 2, allComplete: true },
        });
        expect(best).toEqual({ bestXp: 100, bestXpDate: '2025-01-01', longestActive: { count: 2, start: '2025-01-01', end: '2025-01-02' }, longestPerfect: { count: 1, start: '2025-01-01', end: '2025-01-01' } });
    });
    it('同率はログの挿入順でなく最初の達成日/区間に決定する', () => {
        const entries: [string, number][] = [['2026-05-11', 50], ['2026-05-10', 50], ['2026-04-02', 50], ['2026-04-01', 50]];
        const a = getStatsBestRecords(Object.fromEntries(entries), {});
        const b = getStatsBestRecords(Object.fromEntries([...entries].reverse()), {});
        expect(a).toEqual(b); expect(a.bestXpDate).toBe('2026-04-01');
        expect(a.longestActive).toEqual({ count: 2, start: '2026-04-01', end: '2026-04-02' });
    });
    it('連続区間は年・月・うるう日をまたぎ、期間表示も一致する', () => {
        const active = getStatsBestRecords({ '2025-12-31': 10, '2026-01-01': 10 }, {}).longestActive;
        expect(formatStatsStreakRange(active)).toBe('2025-12-31 〜 2026-01-01');
        const perfect = getStatsBestRecords({}, Object.fromEntries(['2024-02-28', '2024-02-29', '2024-03-01'].map((date) => [date, { count: 1, allComplete: true }]))).longestPerfect;
        expect(perfect.count).toBe(3);
        expect(formatStatsStreakRange({ count: 1, start: '2026-08-10', end: '2026-08-10' })).toBe('2026-08-10');
    });
    it('ログを並べ替えたり書き換えたりせず、大きな値もそのまま読み取る', () => {
        const xp = Object.freeze({ '2026-08-10': 1_000_000_000_000, '2026-08-09': 5 });
        const habits = Object.freeze({ '2026-08-10': Object.freeze({ count: 1, allComplete: true }) });
        const before = JSON.stringify({ xp, habits });
        expect(getWeeklyTaskXp(xp, '2026-08-10').total).toBe(1_000_000_000_005);
        expect(getStatsBestRecords(xp, habits).bestXp).toBe(1_000_000_000_000);
        expect(JSON.stringify({ xp, habits })).toBe(before);
    });
});

describe('保存済みログの119日集計', () => {
    const today = '2026-08-10';
    const dates = generateDateRange(STATS_DISPLAY_DAYS, today);
    const xp = { '2026-08-07': 10, '2026-08-08': 20, '2026-08-09': 0, '2026-08-10': 30, '2026-01-01': 999, '2026-08-11': 999 };
    const habits = { '2026-08-07': { count: 2, allComplete: true }, '2026-08-08': { count: 3, allComplete: true }, '2026-08-09': { count: 1, allComplete: false }, '2026-08-10': { count: 2, allComplete: true } };
    it('タスクは期間内だけを数え、現在と最長の連続を区別する', () => {
        expect(dates).toHaveLength(119);
        expect(summarizeStats(dates, xp, habits, 'tasks')).toEqual({ total: 60, activeDays: 3, currentStreak: 1, maxStreak: 2 });
    });
    it('習慣は合計達成数と全達成日数を区別する', () => {
        expect(summarizeStats(dates, xp, habits, 'habits')).toEqual({ total: 8, activeDays: 3, currentStreak: 1, maxStreak: 2 });
    });
    it('初日境界を含み、欠損日と翌日の未達成は連続を切る', () => {
        expect(summarizeStats(dates, { [dates[0]]: 5 }, {}, 'tasks')).toEqual({ total: 5, activeDays: 1, currentStreak: 0, maxStreak: 1 });
        expect(summarizeStats(generateDateRange(119, '2026-08-11'), xp, habits, 'habits').currentStreak).toBe(0);
        expect(summarizeStats([], {}, {}, 'tasks')).toEqual({ total: 0, activeDays: 0, currentStreak: 0, maxStreak: 0 });
    });
    it('日別詳細は濃淡でなく実数と全達成を示し、ログを書き換えない', () => {
        const before = JSON.stringify({ xp, habits });
        expect(getStatsDayValue(today, xp, habits, 'tasks')).toBe('30 XP');
        expect(getStatsDayValue(today, xp, habits, 'habits')).toBe('2個達成 (全達成!)');
        expect(getStatsDayValue('2026-08-06', xp, habits, 'tasks')).toBe('0 XP');
        expect(getStatsDayValue('2026-08-06', xp, habits, 'habits')).toBe('0個達成');
        summarizeStats(dates, xp, habits, 'tasks'); expect(JSON.stringify({ xp, habits })).toBe(before);
    });
    it.each([
        ['2026-08-10T14:59:59.999Z', 1], ['2026-08-10T15:00:00.000Z', 86400000],
        ['2025-12-31T14:59:00.000Z', 60000], ['2024-02-28T15:00:00.000Z', 86400000],
    ])('JST午前0時までの待機 %s', (time, ms) => { expect(msUntilNextJstDay(Date.parse(time))).toBe(ms); });
});

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

    it('暦上無効なtodayも旧shiftYmdと同じDate正規化で並べる', () => {
        expect(generateDateRange(2, '2025-02-29')).toEqual(['2025-02-28', '2025-03-01']);
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
