import { describe, expect, it } from 'vitest';
import { captureTaskEdit, createTask, type Task } from './tasks';

const task = (): Task => createTask({ id: 'one', name: '編集対象', now: '2026-10-19T00:00:00Z',
    tags: ['tag'], subtasks: [{ id: 'sub', name: '子', completed: false, completedAt: null, createdAt: '2026-10-19T00:00:00Z' }] })!;

describe('task draft optimistic edit guard', () => {
    it('同値pullとキー順の違いは許可し、別タスクの変更に影響されない', () => {
        const original = task(); const accepts = captureTaskEdit(original);
        expect(accepts({ ...structuredClone(original), name: original.name })).toBe(true);
        expect(accepts(undefined)).toBe(false);
        expect(accepts({ ...original, id: 'other' })).toBe(false);
    });
    it.each(['name', 'dueDate', 'priority', 'recurrence', 'tags', 'subtasks', 'completed', 'createdAt'] as const)('%sが変わった対象を上書きしない', (field) => {
        const original = task(); const accepts = captureTaskEdit(original); const changed = structuredClone(original);
        if (field === 'name') changed.name = '同期後';
        if (field === 'dueDate') changed.dueDate = '2026-10-20';
        if (field === 'priority') changed.priority = 'high';
        if (field === 'recurrence') changed.recurrence = 'weekly';
        if (field === 'tags') changed.tags.push('new');
        if (field === 'subtasks') changed.subtasks[0].completed = true;
        if (field === 'completed') { changed.completed = true; changed.completedAt = '2026-10-19T01:00:00Z'; }
        if (field === 'createdAt') changed.createdAt = '2026-10-20T00:00:00Z';
        expect(accepts(changed)).toBe(false);
    });
    it('捕捉後に元オブジェクトのネストが変わっても比較元を固定する', () => {
        const original = task(); const accepts = captureTaskEdit(original);
        original.subtasks[0].name = '変更';
        expect(accepts(original)).toBe(false);
    });
});
