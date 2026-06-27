import { describe, it, expect } from 'vitest';
import {
    computeLongestConsecutive,
    getWeekdayName,
    getTaskLevel,
    getHabitLevel,
    generateDateRange,
    groupByWeeks,
    getMonthLabels,
} from './statsHeatmap';

describe('computeLongestConsecutive', () => {
    it('空セットは count 0 を返す', () => {
        expect(computeLongestConsecutive(new Set())).toEqual({ count: 0, start: '', end: '' });
    });

    it('連続した日付の最長区間を返す', () => {
        const set = new Set(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-05']);
        expect(computeLongestConsecutive(set)).toEqual({ count: 3, start: '2026-01-01', end: '2026-01-03' });
    });

    it('単日は count 1', () => {
        expect(computeLongestConsecutive(new Set(['2026-01-10']))).toEqual({
            count: 1, start: '2026-01-10', end: '2026-01-10',
        });
    });

    it('月跨ぎの連続も検出する', () => {
        const set = new Set(['2026-01-30', '2026-01-31', '2026-02-01']);
        expect(computeLongestConsecutive(set).count).toBe(3);
    });
});

describe('getTaskLevel', () => {
    it.each([
        [0, 0], [1, 1], [15, 1], [16, 2], [30, 2], [31, 3], [50, 3], [51, 4], [9999, 4],
    ])('xp=%i → level=%i', (xp, level) => {
        expect(getTaskLevel(xp)).toBe(level);
    });
});

describe('getHabitLevel', () => {
    it('allComplete は最大レベル4', () => expect(getHabitLevel(1, true)).toBe(4));
    it('0件は0', () => expect(getHabitLevel(0, false)).toBe(0));
    it('1件は1', () => expect(getHabitLevel(1, false)).toBe(1));
    it('3件は2', () => expect(getHabitLevel(3, false)).toBe(2));
    it('4件は3', () => expect(getHabitLevel(4, false)).toBe(3));
});

describe('generateDateRange', () => {
    it('指定日数分の配列を返す', () => {
        expect(generateDateRange(7)).toHaveLength(7);
        expect(generateDateRange(30)).toHaveLength(30);
    });

    it('YYYY-MM-DD 形式で昇順に並ぶ', () => {
        const range = generateDateRange(5);
        range.forEach((d) => expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/));
        expect([...range].sort()).toEqual(range);
    });

    it('最終要素は今日（JST）に対応する', () => {
        const range = generateDateRange(3);
        const expectedToday = toIsoFromJst();
        expect(range[range.length - 1]).toBe(expectedToday);
    });
});

describe('groupByWeeks', () => {
    it('各週は必ず7要素になる', () => {
        const weeks = groupByWeeks(generateDateRange(20));
        weeks.forEach((week) => expect(week).toHaveLength(7));
    });

    it('全要素を保持する（パディング込み）', () => {
        const dates = generateDateRange(14);
        const flat = groupByWeeks(dates).flat().filter((d) => d !== '');
        expect(flat).toEqual(dates);
    });
});

describe('getMonthLabels', () => {
    it('月の変わり目にラベルを付ける', () => {
        const weeks = groupByWeeks(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
        const labels = getMonthLabels(weeks);
        expect(labels.length).toBeGreaterThan(0);
        labels.forEach((l) => expect(l.label).toMatch(/月$/));
    });
});

describe('getWeekdayName', () => {
    it('7曜日名のいずれかを返す（TZ非依存検証）', () => {
        expect(['日', '月', '火', '水', '木', '金', '土']).toContain(getWeekdayName('2026-01-01'));
    });
});

/** generateDateRange と同じ JST 基準で「今日」を求めるテスト用ヘルパー */
function toIsoFromJst(): string {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
}
