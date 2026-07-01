import { describe, expect, it } from 'vitest';
import {
    createHabit,
    removeHabitData,
    sanitizeHabitCollection,
    sanitizeHabitRecords,
    toggleHabitDailyRecord,
} from './habits';

describe('habit domain', () => {
    it('creates a normalized habit', () => {
        expect(createHabit('h1', '  運動  ', 'health', '2026-07-01T00:00:00.000Z')).toEqual({
            id: 'h1',
            name: '運動',
            categoryId: 'health',
            createdAt: '2026-07-01T00:00:00.000Z',
        });
        expect(createHabit('h1', ' ', 'health', 'now')).toBeNull();
    });

    it('creates and toggles a daily record', () => {
        const completed = toggleHabitDailyRecord([], 'h1', '2026-07-01');
        expect(completed).toEqual([{ habitId: 'h1', date: '2026-07-01', completed: true, memo: '' }]);
        expect(toggleHabitDailyRecord(completed, 'h1', '2026-07-01')[0].completed).toBe(false);
    });

    it('removes a habit together with its records', () => {
        const habit = createHabit('h1', '運動', 'health', 'now')!;
        expect(removeHabitData([habit], [{ habitId: 'h1', date: '2026-07-01', completed: true, memo: '' }], 'h1')).toEqual({ habits: [], records: [] });
    });

    it('sanitizes duplicate habits and orphan records', () => {
        const habits = sanitizeHabitCollection([{ id: 'h1', name: '運動' }, { id: 'h1', name: '重複' }, null]);
        expect(habits).toHaveLength(1);
        const records = sanitizeHabitRecords([
            { habitId: 'h1', date: '2026-07-01', completed: true },
            { habitId: 'missing', date: '2026-07-01', completed: true },
        ], new Set(['h1']));
        expect(records).toEqual([{ habitId: 'h1', date: '2026-07-01', completed: true, memo: '' }]);
    });
});
