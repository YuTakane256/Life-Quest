import { describe, expect, it } from 'vitest';
import { captureHabitMemoEdit, type Habit, type HabitDailyRecord } from './habits';
const habit = (): Habit => ({ id: 'one', name: '読書', categoryId: 'study', createdAt: '2026-10-19T00:00:00Z' });
const record = (): HabitDailyRecord => ({ habitId: 'one', date: '2026-10-19', completed: true, memo: '' });
describe('habit memo local edit guard', () => {
    it('同値のhabit/recordを許可する', () => { expect(captureHabitMemoEdit(habit(), record())(habit(), record())).toBe(true); });
    it.each(['missing-habit', 'missing-record', 'name', 'category', 'createdAt', 'date', 'id', 'completed', 'memo'] as const)('%sの変更を上書きしない', (change) => {
        const accepts = captureHabitMemoEdit(habit(), record()); const target = habit(); const entry = record();
        if (change === 'name') target.name = '変更';
        if (change === 'category') target.categoryId = 'health';
        if (change === 'createdAt') target.createdAt = '2026-10-20T00:00:00Z';
        if (change === 'date') entry.date = '2026-10-20';
        if (change === 'id') entry.habitId = 'two';
        if (change === 'completed') entry.completed = false;
        if (change === 'memo') entry.memo = '同期後';
        expect(accepts(change === 'missing-habit' ? undefined : target, change === 'missing-record' ? undefined : entry)).toBe(false);
    });
    it('捕捉後の元オブジェクトの変更でも比較元は変わらない', () => {
        const target = habit(); const entry = record(); const accepts = captureHabitMemoEdit(target, entry);
        entry.memo = '変更'; expect(accepts(target, entry)).toBe(false);
    });
});
