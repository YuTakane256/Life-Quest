import { describe, expect, it } from 'vitest';
import type { Habit, HabitDailyRecord, RestDay } from '../types';
import { buildHabitHeatmapData } from './habitHeatmap';

const habit: Habit = {
    id: 'habit-1',
    name: '読書',
    categoryId: 'learning',
    createdAt: '2026-06-28T00:00:00.000Z',
};

describe('buildHabitHeatmapData', () => {
    it('distinguishes completed, rest, pending, and pre-creation days', () => {
        const records: HabitDailyRecord[] = [
            { habitId: habit.id, date: '2026-06-29', completed: true, memo: '10ページ' },
            { habitId: 'other', date: '2026-06-30', completed: true, memo: '' },
        ];
        const restDays: RestDay[] = [{ date: '2026-06-30', isRest: true }];

        const result = buildHabitHeatmapData(habit, records, restDays, '2026-07-01', 5);

        expect(result.days.map((day) => day.status)).toEqual([
            'before-created',
            'missed',
            'completed',
            'rest',
            'pending',
        ]);
        expect(result.days[2].memo).toBe('10ページ');
        expect(result).toMatchObject({ completedCount: 1, activeDayCount: 3, completionRate: 33 });
    });
});
