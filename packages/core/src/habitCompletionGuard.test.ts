import { describe, expect, it } from 'vitest';
import { captureHabitCompletion, type Habit, type HabitDailyRecord } from './habits.ts';

const habit: Habit = { id: 'one', name: '読書', categoryId: 'study', createdAt: '2026-10-20T00:00:00Z' };
const record: HabitDailyRecord = { habitId: 'one', date: '2026-10-21', completed: false, memo: '' };
describe('captureHabitCompletion', () => {
    it('freezes values, not object identity', () => {
        const target = { ...habit }; const entry = { ...record }; const accepts = captureHabitCompletion(target, entry);
        target.name = 'changed'; entry.memo = 'changed';
        expect(accepts({ ...habit }, { ...record })).toBe(true); expect(accepts(target, entry)).toBe(false);
    });
    it('distinguishes a missing record from an explicit incomplete record', () => {
        expect(captureHabitCompletion(habit, undefined)(habit, undefined)).toBe(true);
        expect(captureHabitCompletion(habit, undefined)(habit, record)).toBe(false);
        expect(captureHabitCompletion(habit, record)(habit, undefined)).toBe(false);
        expect(captureHabitCompletion(habit, record)(undefined, record)).toBe(false);
    });
    it.each(['id', 'name', 'categoryId', 'createdAt'] as const)('rejects changed habit %s', (key) => {
        expect(captureHabitCompletion(habit, record)({ ...habit, [key]: 'changed' }, record)).toBe(false);
    });
    it.each(['habitId', 'date', 'completed', 'memo'] as const)('rejects changed record %s', (key) => {
        expect(captureHabitCompletion(habit, record)(habit, { ...record, [key]: key === 'completed' ? true : 'changed' })).toBe(false);
    });
});
