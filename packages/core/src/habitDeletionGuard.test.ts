import { describe, expect, it } from 'vitest';
import { captureHabitDeletion, type Habit, type HabitDailyRecord } from './habits';

const habit = (): Habit => ({ id: 'one', name: '読書', categoryId: 'study', createdAt: '2026-10-19T00:00:00Z' });
const records = (): HabitDailyRecord[] => [
    { habitId: 'one', date: '2026-10-18', completed: true, memo: '履歴' },
    { habitId: 'one', date: '2026-10-19', completed: false, memo: '' },
];
describe('habit deletion approval', () => {
    it('同値pullと記録の並び替えは許可する', () => {
        expect(captureHabitDeletion(habit(), records())(habit(), records().reverse())).toBe(true);
    });
    it('別の習慣の記録は承認に影響しない', () => {
        expect(captureHabitDeletion(habit(), records())(habit(), [...records(), { ...records()[0], habitId: 'other' }])).toBe(true);
    });
    it.each(['missing', 'id', 'name', 'category', 'createdAt', 'added', 'removed', 'memo', 'completed', 'date'] as const)('%sは削除を拒否する', (change) => {
        const accepts = captureHabitDeletion(habit(), records()); const target = habit(); const entries = records();
        if (change === 'id') target.id = 'other';
        if (change === 'name') target.name = '変更';
        if (change === 'category') target.categoryId = 'health';
        if (change === 'createdAt') target.createdAt = '2026-10-20T00:00:00Z';
        if (change === 'added') entries.push({ ...entries[0], date: '2026-10-20' });
        if (change === 'removed') entries.pop();
        if (change === 'memo') entries[0].memo = '同期変更';
        if (change === 'completed') entries[0].completed = false;
        if (change === 'date') entries[0].date = '2026-10-17';
        expect(accepts(change === 'missing' ? undefined : target, entries)).toBe(false);
    });
    it('元オブジェクトを変更しても承認内容は変わらない', () => {
        const target = habit(); const entries = records(); const accepts = captureHabitDeletion(target, entries);
        entries[0].memo = '変更'; expect(accepts(target, entries)).toBe(false);
    });
});
