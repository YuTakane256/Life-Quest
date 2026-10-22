import { describe, expect, it } from 'vitest';
import { getHabitHistoryNavigation, type HabitHeatmapDay } from './habitHeatmap';

const days: HabitHeatmapDay[] = [
    { date: '2026-08-08', status: 'before-created', memo: '' },
    { date: '2026-08-09', status: 'rest', memo: '休息' },
    { date: '2026-08-10', status: 'completed', memo: '読書' },
];
describe('read-only habit history navigation', () => {
    it('starts from today without implicitly selecting it', () => {
        expect(getHabitHistoryNavigation(days, null)).toEqual({ selectedDay: null, previousDate: '2026-08-09', nextDate: null });
    });
    it('returns adjacent dates and the original latest record', () => {
        expect(getHabitHistoryNavigation(days, '2026-08-09')).toEqual({ selectedDay: days[1], previousDate: '2026-08-08', nextDate: '2026-08-10' });
        expect(getHabitHistoryNavigation(days, '2026-08-08').previousDate).toBeNull();
    });
    it('recovers an expired selection without modifying input', () => {
        const before = structuredClone(days);
        expect(getHabitHistoryNavigation(days, '2025-01-01').previousDate).toBe('2026-08-09');
        expect(days).toEqual(before);
    });
    it('handles an empty or one-day range', () => {
        expect(getHabitHistoryNavigation([], null)).toEqual({ selectedDay: null, previousDate: null, nextDate: null });
        expect(getHabitHistoryNavigation(days.slice(0, 1), days[0].date)).toEqual({ selectedDay: days[0], previousDate: null, nextDate: null });
    });
});
