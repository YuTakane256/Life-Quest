import { beforeEach, describe, expect, it } from 'vitest';
import { useTaskStore } from './useTaskStore';
import type { Subtask } from '../types';

/** 各テストで store と localStorage を初期状態に戻す */
function resetStore() {
    localStorage.clear();
    useTaskStore.setState({ tasks: [], pendingCompletions: [] });
}

describe('useTaskStore', () => {
    beforeEach(() => {
        resetStore();
    });

    describe('addTask', () => {
        it('渡した値でタスクを追加する', () => {
            useTaskStore.getState().addTask('読書', '2025-04-01', 'high', 'daily', ['趣味'], []);
            const tasks = useTaskStore.getState().tasks;
            expect(tasks).toHaveLength(1);
            expect(tasks[0]).toMatchObject({
                name: '読書',
                dueDate: '2025-04-01',
                priority: 'high',
                recurrence: 'daily',
                tags: ['趣味'],
                subtasks: [],
                completed: false,
                completedAt: null,
            });
            expect(tasks[0].id).toMatch(/^\d+-/);
            // createdAt は ISO 8601 文字列
            expect(() => new Date(tasks[0].createdAt).toISOString()).not.toThrow();
        });

        it('複数回呼び出すと末尾に追加され ID がユニーク', () => {
            const { addTask } = useTaskStore.getState();
            addTask('A', null, 'low', 'none');
            addTask('B', null, 'medium', 'none');
            addTask('C', null, 'high', 'none');
            const tasks = useTaskStore.getState().tasks;
            expect(tasks.map((t) => t.name)).toEqual(['A', 'B', 'C']);
            const ids = new Set(tasks.map((t) => t.id));
            expect(ids.size).toBe(3);
        });

        it('既定値: tags / subtasks が空配列', () => {
            useTaskStore.getState().addTask('シンプル', null, 'medium', 'none');
            const task = useTaskStore.getState().tasks[0];
            expect(task.tags).toEqual([]);
            expect(task.subtasks).toEqual([]);
        });
    });

    describe('updateTask', () => {
        it('name / priority / tags の部分更新が反映される', () => {
            useTaskStore.getState().addTask('元タスク', null, 'low', 'none', ['x']);
            const id = useTaskStore.getState().tasks[0].id;
            useTaskStore.getState().updateTask(id, { name: '新タスク', priority: 'high', tags: ['y', 'z'] });
            const task = useTaskStore.getState().tasks[0];
            expect(task.name).toBe('新タスク');
            expect(task.priority).toBe('high');
            expect(task.tags).toEqual(['y', 'z']);
            // 更新されないフィールドは維持
            expect(task.recurrence).toBe('none');
        });

        it('subtasks 全完了で親タスクが completed: true', () => {
            useTaskStore.getState().addTask('親', null, 'medium', 'none');
            const id = useTaskStore.getState().tasks[0].id;
            const allDone: Subtask[] = [
                { id: 'a', name: 'a', completed: true, completedAt: '2025-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' },
                { id: 'b', name: 'b', completed: true, completedAt: '2025-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' },
            ];
            useTaskStore.getState().updateTask(id, { subtasks: allDone });
            const task = useTaskStore.getState().tasks[0];
            expect(task.completed).toBe(true);
            expect(task.completedAt).not.toBeNull();
        });

        it('subtasks 一部だけ完了なら親タスクは completed: false', () => {
            useTaskStore.getState().addTask('親', null, 'medium', 'none');
            const id = useTaskStore.getState().tasks[0].id;
            const partial: Subtask[] = [
                { id: 'a', name: 'a', completed: true, completedAt: '2025-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' },
                { id: 'b', name: 'b', completed: false, completedAt: null, createdAt: '2025-01-01T00:00:00Z' },
            ];
            useTaskStore.getState().updateTask(id, { subtasks: partial });
            const task = useTaskStore.getState().tasks[0];
            expect(task.completed).toBe(false);
            expect(task.completedAt).toBeNull();
        });

        it('存在しない id は無視（タスク数が変わらない）', () => {
            useTaskStore.getState().addTask('A', null, 'low', 'none');
            useTaskStore.getState().updateTask('does-not-exist', { name: 'x' });
            expect(useTaskStore.getState().tasks).toHaveLength(1);
            expect(useTaskStore.getState().tasks[0].name).toBe('A');
        });
    });

    describe('deleteCompletedTasks', () => {
        it('completed: true のタスクだけ削除する', () => {
            const { addTask } = useTaskStore.getState();
            addTask('A', null, 'low', 'none');
            addTask('B', null, 'medium', 'none');
            addTask('C', null, 'high', 'none');
            const ids = useTaskStore.getState().tasks.map((t) => t.id);
            // B だけ手動で completed に
            useTaskStore.setState((state) => ({
                tasks: state.tasks.map((t) => t.id === ids[1] ? { ...t, completed: true, completedAt: '2025-01-01T00:00:00Z' } : t),
            }));
            useTaskStore.getState().deleteCompletedTasks();
            const remaining = useTaskStore.getState().tasks.map((t) => t.name);
            expect(remaining).toEqual(['A', 'C']);
        });

        it('pendingCompletions に含まれるタスクは completed でも残る', () => {
            useTaskStore.getState().addTask('A', null, 'low', 'none');
            const id = useTaskStore.getState().tasks[0].id;
            // 完了状態 + pending（5秒Undo中）に設定
            useTaskStore.setState((state) => ({
                tasks: state.tasks.map((t) => ({ ...t, completed: true, completedAt: '2025-01-01T00:00:00Z' })),
                pendingCompletions: [{ taskId: id, timeoutId: 0, completedAt: '2025-01-01T00:00:00Z' }],
            }));
            useTaskStore.getState().deleteCompletedTasks();
            // 保留中なので残る
            expect(useTaskStore.getState().tasks).toHaveLength(1);
            expect(useTaskStore.getState().tasks[0].id).toBe(id);
        });

        it('全タスクが未完了なら何も起きない', () => {
            useTaskStore.getState().addTask('A', null, 'low', 'none');
            useTaskStore.getState().addTask('B', null, 'medium', 'none');
            useTaskStore.getState().deleteCompletedTasks();
            expect(useTaskStore.getState().tasks).toHaveLength(2);
        });
    });

    describe('addSubtask', () => {
        it('既存タスクに新規サブタスクを追加する', () => {
            useTaskStore.getState().addTask('親', null, 'medium', 'none');
            const id = useTaskStore.getState().tasks[0].id;
            useTaskStore.getState().addSubtask(id, '子タスクA');
            const subtasks = useTaskStore.getState().tasks[0].subtasks;
            expect(subtasks).toHaveLength(1);
            expect(subtasks[0]).toMatchObject({
                name: '子タスクA',
                completed: false,
                completedAt: null,
            });
            expect(subtasks[0].id).toMatch(/^\d+-/);
        });

        it('空文字は無視される', () => {
            useTaskStore.getState().addTask('親', null, 'medium', 'none');
            const id = useTaskStore.getState().tasks[0].id;
            useTaskStore.getState().addSubtask(id, '');
            useTaskStore.getState().addSubtask(id, '   ');
            expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(0);
        });

        it('複数追加で末尾に積まれる', () => {
            useTaskStore.getState().addTask('親', null, 'medium', 'none');
            const id = useTaskStore.getState().tasks[0].id;
            useTaskStore.getState().addSubtask(id, '1');
            useTaskStore.getState().addSubtask(id, '2');
            useTaskStore.getState().addSubtask(id, '3');
            const names = useTaskStore.getState().tasks[0].subtasks.map((s) => s.name);
            expect(names).toEqual(['1', '2', '3']);
        });

        it('前後の空白はトリムされる', () => {
            useTaskStore.getState().addTask('親', null, 'medium', 'none');
            const id = useTaskStore.getState().tasks[0].id;
            useTaskStore.getState().addSubtask(id, '  名前  ');
            expect(useTaskStore.getState().tasks[0].subtasks[0].name).toBe('名前');
        });
    });
});
