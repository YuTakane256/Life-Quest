import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore } from './useTaskStore';
import type { Subtask, Task } from '../types';

function resetStore() {
    localStorage.clear();
    useTaskStore.setState({ tasks: [], pendingCompletions: [] });
}

function makeSubtask(overrides: Partial<Subtask> = {}): Subtask {
    return {
        id: 'sub-' + Math.random().toString(36).slice(2, 8),
        name: '子タスク',
        completed: false,
        completedAt: null,
        createdAt: '2025-03-15T00:00:00.000Z',
        ...overrides,
    };
}

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-' + Math.random().toString(36).slice(2, 8),
        name: '親タスク',
        dueDate: null,
        priority: 'medium',
        tags: [],
        subtasks: [],
        recurrence: 'none',
        completed: false,
        completedAt: null,
        createdAt: '2025-03-15T00:00:00.000Z',
        ...overrides,
    };
}

describe('useTaskStore mutation edges', () => {
    beforeEach(() => {
        resetStore();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('duplicateTask は期限付きタスクを今日の日付に複製し、サブタスクを未完了の新IDに戻す', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T03:00:00.000Z'));
        const originalSubtasks = [
            makeSubtask({ id: 'sub-a', name: '調査', completed: true, completedAt: '2025-03-14T00:00:00.000Z' }),
            makeSubtask({ id: 'sub-b', name: '実装', completed: false, completedAt: null }),
        ];
        useTaskStore.setState({
            tasks: [
                makeTask({
                    id: 'task-a',
                    name: '大きなタスク',
                    dueDate: '2025-04-01',
                    priority: 'high',
                    tags: ['仕事', '重要'],
                    subtasks: originalSubtasks,
                    recurrence: 'weekly',
                    completed: true,
                    completedAt: '2025-03-14T00:00:00.000Z',
                }),
            ],
        });

        const duplicateId = useTaskStore.getState().duplicateTask('task-a');
        const tasks = useTaskStore.getState().tasks;
        const duplicate = tasks.find((task) => task.id === duplicateId);

        expect(duplicateId).toBeTruthy();
        expect(tasks).toHaveLength(2);
        expect(duplicate).toMatchObject({
            name: '大きなタスク',
            dueDate: '2025-03-15',
            priority: 'high',
            tags: ['仕事', '重要'],
            recurrence: 'weekly',
            completed: false,
            completedAt: null,
        });
        expect(duplicate?.subtasks).toHaveLength(2);
        expect(duplicate?.subtasks.map((subtask) => subtask.name)).toEqual(['調査', '実装']);
        expect(duplicate?.subtasks.every((subtask) => !subtask.completed && subtask.completedAt === null)).toBe(true);
        expect(duplicate?.subtasks.map((subtask) => subtask.id)).not.toEqual(['sub-a', 'sub-b']);
    });

    it('duplicateTask は期限なしタスクを期限なしのまま複製し、存在しないIDでは null を返す', () => {
        useTaskStore.setState({
            tasks: [makeTask({ id: 'task-no-due', dueDate: null })],
        });

        const duplicateId = useTaskStore.getState().duplicateTask('task-no-due');
        const missingResult = useTaskStore.getState().duplicateTask('missing');
        const duplicate = useTaskStore.getState().tasks.find((task) => task.id === duplicateId);

        expect(duplicate?.dueDate).toBeNull();
        expect(missingResult).toBeNull();
        expect(useTaskStore.getState().tasks).toHaveLength(2);
    });

    it('deleteTask はタスク本体と pending completion を削除し、タイマーも止める', () => {
        const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
        useTaskStore.setState({
            tasks: [makeTask({ id: 'pending-task' })],
            pendingCompletions: [
                { taskId: 'pending-task', timeoutId: 123, completedAt: '2025-03-15T00:00:00.000Z' },
            ],
        });

        useTaskStore.getState().deleteTask('pending-task');

        expect(useTaskStore.getState().tasks).toHaveLength(0);
        expect(useTaskStore.getState().pendingCompletions).toHaveLength(0);
        expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
    });

    it('updateTask でサブタスクを更新すると、保留中の親タスク完了をキャンセルする', () => {
        const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
        useTaskStore.setState({
            tasks: [makeTask({ id: 'task-a', completed: true, completedAt: '2025-03-15T00:00:00.000Z' })],
            pendingCompletions: [
                { taskId: 'task-a', timeoutId: 456, completedAt: '2025-03-15T00:00:00.000Z' },
            ],
        });

        useTaskStore.getState().updateTask('task-a', {
            subtasks: [makeSubtask({ id: 'sub-a', completed: false, completedAt: null })],
        });
        const task = useTaskStore.getState().tasks[0];

        expect(clearTimeoutSpy).toHaveBeenCalledWith(456);
        expect(useTaskStore.getState().pendingCompletions).toHaveLength(0);
        expect(task.completed).toBe(false);
        expect(task.completedAt).toBeNull();
    });

    it('addSubtask は完了済みの親タスクを未完了に戻す', () => {
        useTaskStore.setState({
            tasks: [
                makeTask({
                    id: 'done-task',
                    completed: true,
                    completedAt: '2025-03-15T00:00:00.000Z',
                }),
            ],
        });

        useTaskStore.getState().addSubtask('done-task', '追加作業');
        const task = useTaskStore.getState().tasks[0];

        expect(task.completed).toBe(false);
        expect(task.completedAt).toBeNull();
        expect(task.subtasks[0].name).toBe('追加作業');
    });

    it('deleteSubtask は残ったサブタスクがすべて完了済みなら親タスクを自動完了する', () => {
        useTaskStore.setState({
            tasks: [
                makeTask({
                    id: 'task-a',
                    subtasks: [
                        makeSubtask({ id: 'done', completed: true, completedAt: '2025-03-15T00:00:00.000Z' }),
                        makeSubtask({ id: 'todo', completed: false, completedAt: null }),
                    ],
                }),
            ],
        });

        useTaskStore.getState().deleteSubtask('task-a', 'todo');
        const task = useTaskStore.getState().tasks[0];

        expect(task.subtasks.map((subtask) => subtask.id)).toEqual(['done']);
        expect(task.completed).toBe(true);
        expect(task.completedAt).not.toBeNull();
    });

    it('deleteSubtask は存在しないIDでは状態を変えない', () => {
        const task = makeTask({
            id: 'task-a',
            subtasks: [makeSubtask({ id: 'sub-a' })],
        });
        useTaskStore.setState({ tasks: [task] });

        useTaskStore.getState().deleteSubtask('task-a', 'missing');
        useTaskStore.getState().deleteSubtask('missing-task', 'sub-a');

        expect(useTaskStore.getState().tasks).toEqual([task]);
    });
});
