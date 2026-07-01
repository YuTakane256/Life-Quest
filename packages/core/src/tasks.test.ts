import { describe, expect, it } from 'vitest';
import { createTask, removeTask, sanitizeTaskCollection, TASK_LIMITS, toggleTaskCompletion } from './tasks';

const now = '2026-07-01T00:00:00.000Z';

describe('task domain', () => {
    it('creates a normalized task', () => {
        expect(createTask({ id: 'task-1', name: '  読書  ', now })).toEqual({
            id: 'task-1',
            name: '読書',
            dueDate: null,
            priority: 'medium',
            tags: [],
            subtasks: [],
            recurrence: 'none',
            completed: false,
            completedAt: null,
            createdAt: now,
        });
    });

    it('rejects an empty task name', () => {
        expect(createTask({ id: 'task-1', name: '   ', now })).toBeNull();
    });

    it('toggles completion without mutating the input', () => {
        const task = createTask({ id: 'task-1', name: '読書', now })!;
        const completed = toggleTaskCompletion([task], task.id, '2026-07-02T00:00:00.000Z');
        expect(completed[0]).toMatchObject({ completed: true, completedAt: '2026-07-02T00:00:00.000Z' });
        expect(task.completed).toBe(false);
        expect(toggleTaskCompletion(completed, task.id, now)[0]).toMatchObject({ completed: false, completedAt: null });
    });

    it('removes only the requested task', () => {
        const first = createTask({ id: 'first', name: 'A', now })!;
        const second = createTask({ id: 'second', name: 'B', now })!;
        expect(removeTask([first, second], first.id)).toEqual([second]);
    });

    it('sanitizes malformed persisted collections and duplicate ids', () => {
        expect(sanitizeTaskCollection([
            { id: 'one', name: 'A', priority: 'unknown' },
            { id: 'one', name: 'duplicate' },
            null,
        ])).toEqual([expect.objectContaining({ id: 'one', name: 'A', priority: 'medium' })]);
    });

    it('bounds persisted collection size', () => {
        const tasks = Array.from({ length: TASK_LIMITS.maxTasks + 1 }, (_, index) => ({ id: String(index), name: `Task ${index}` }));
        const sanitized = sanitizeTaskCollection(tasks);
        expect(sanitized).toHaveLength(TASK_LIMITS.maxTasks);
        expect(sanitized[0].id).toBe('1');
    });
});
