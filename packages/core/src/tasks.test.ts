import { describe, expect, it } from 'vitest';
import {
    addRecurrenceInterval,
    addSubtaskToTask,
    buildNextRecurringTask,
    createTask,
    getSubtaskRewardXp,
    hasOpenRecurringDuplicate,
    removeSubtaskFromTask,
    removeTask,
    sanitizeTaskCollection,
    TASK_LIMITS,
    toggleSubtask,
    toggleTaskCompletion,
    type Task,
} from './tasks';

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

describe('getSubtaskRewardXp', () => {
    it('優先度XPの半分（切り捨て・最低1）を返す', () => {
        expect(getSubtaskRewardXp('low')).toBe(5);
        expect(getSubtaskRewardXp('medium')).toBe(10);
        expect(getSubtaskRewardXp('high')).toBe(15);
    });
});

describe('addRecurrenceInterval', () => {
    it('毎日・毎週を正しく進める（月跨ぎ含む）', () => {
        expect(addRecurrenceInterval('2026-07-03', 'daily')).toBe('2026-07-04');
        expect(addRecurrenceInterval('2026-07-31', 'daily')).toBe('2026-08-01');
        expect(addRecurrenceInterval('2026-07-03', 'weekly')).toBe('2026-07-10');
        expect(addRecurrenceInterval('2026-12-28', 'weekly')).toBe('2027-01-04');
    });

    it('毎月は同日へ進め、存在しない日は月末へ丸める', () => {
        expect(addRecurrenceInterval('2026-07-15', 'monthly')).toBe('2026-08-15');
        expect(addRecurrenceInterval('2026-01-31', 'monthly')).toBe('2026-02-28');
        expect(addRecurrenceInterval('2028-01-31', 'monthly')).toBe('2028-02-29'); // うるう年
        expect(addRecurrenceInterval('2026-12-15', 'monthly')).toBe('2027-01-15');
    });

    it('none は変化しない', () => {
        expect(addRecurrenceInterval('2026-07-03', 'none')).toBe('2026-07-03');
    });

    it('不正な日付は例外にする（Webのユーティリティ契約と同一）', () => {
        expect(() => addRecurrenceInterval('2025-02-29', 'daily')).toThrow(RangeError);
        expect(() => addRecurrenceInterval('not-a-date', 'monthly')).toThrow(RangeError);
    });
});

function recurringTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'base', name: '毎日の運動', dueDate: '2026-07-03', priority: 'high', tags: ['健康'],
        subtasks: [
            { id: 's1', name: 'ストレッチ', completed: true, completedAt: '2026-07-03T01:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z' },
        ],
        recurrence: 'daily', completed: false, completedAt: null, createdAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('buildNextRecurringTask', () => {
    const input = {
        taskId: 'next-id',
        subtaskIdFor: () => 'sub-id',
        now: '2026-07-03T10:00:00.000Z',
        today: '2026-07-03',
    };

    it('期限を1周期進め、サブタスクを未完了で引き継ぐ', () => {
        const next = buildNextRecurringTask({ ...input, task: recurringTask() });
        expect(next).toMatchObject({
            id: 'next-id', name: '毎日の運動', dueDate: '2026-07-04', priority: 'high',
            tags: ['健康'], recurrence: 'daily', completed: false,
        });
        expect(next?.subtasks).toEqual([
            { id: 'sub-id', name: 'ストレッチ', completed: false, completedAt: null, createdAt: input.now },
        ]);
    });

    it('期限なしのタスクは今日を起点にする', () => {
        const next = buildNextRecurringTask({ ...input, task: recurringTask({ dueDate: null }) });
        expect(next?.dueDate).toBe('2026-07-04');
    });

    it('不正な期限のタスクも今日を起点にして落とさない', () => {
        const next = buildNextRecurringTask({ ...input, task: recurringTask({ dueDate: 'garbage' }) });
        expect(next?.dueDate).toBe('2026-07-04');
    });

    it('recurrence が none なら null', () => {
        expect(buildNextRecurringTask({ ...input, task: recurringTask({ recurrence: 'none' }) })).toBeNull();
    });
});

describe('hasOpenRecurringDuplicate', () => {
    it('同名・同期限・同繰り返しの未完了タスクを検出する', () => {
        const next = buildNextRecurringTask({
            task: recurringTask(), taskId: 'n', subtaskIdFor: () => 's',
            now: '2026-07-03T10:00:00.000Z', today: '2026-07-03',
        })!;
        expect(hasOpenRecurringDuplicate([next], next)).toBe(true);
        expect(hasOpenRecurringDuplicate([{ ...next, completed: true }], next)).toBe(false);
        expect(hasOpenRecurringDuplicate([{ ...next, dueDate: '2026-07-05' }], next)).toBe(false);
        expect(hasOpenRecurringDuplicate([], next)).toBe(false);
    });
});

describe('サブタスク操作', () => {
    const NOW = '2026-07-03T10:00:00.000Z';

    function parentWith(subtasks: Task['subtasks'], overrides: Partial<Task> = {}): Task {
        return recurringTask({ id: 'p1', recurrence: 'none', subtasks, ...overrides });
    }

    it('addSubtaskToTask は追加して親を未完了へ戻す', () => {
        const parent = parentWith([], { completed: true, completedAt: NOW });
        const result = addSubtaskToTask([parent], 'p1', { id: 'ns', name: '  新サブ  ', now: NOW });
        expect(result?.[0].subtasks).toHaveLength(1);
        expect(result?.[0].subtasks[0].name).toBe('新サブ');
        expect(result?.[0].completed).toBe(false);
        expect(result?.[0].completedAt).toBeNull();
    });

    it('addSubtaskToTask は空名・不明タスク・上限超過で null', () => {
        const parent = parentWith([]);
        expect(addSubtaskToTask([parent], 'p1', { id: 'x', name: '   ', now: NOW })).toBeNull();
        expect(addSubtaskToTask([parent], 'nope', { id: 'x', name: 'a', now: NOW })).toBeNull();
        const full = parentWith(Array.from({ length: 200 }, (_, i) => ({
            id: `s${i}`, name: 'x', completed: false, completedAt: null, createdAt: NOW,
        })));
        expect(addSubtaskToTask([full], 'p1', { id: 'x', name: 'a', now: NOW })).toBeNull();
    });

    it('toggleSubtask で全サブタスク完了なら親も完了し、parentCompleted を報告する', () => {
        const parent = parentWith([
            { id: 's1', name: 'a', completed: true, completedAt: NOW, createdAt: NOW },
            { id: 's2', name: 'b', completed: false, completedAt: null, createdAt: NOW },
        ]);
        const result = toggleSubtask([parent], 'p1', 's2', NOW);
        expect(result?.completedSubtask).toBe(true);
        expect(result?.parentCompleted).toBe(true);
        expect(result?.tasks[0].completed).toBe(true);
    });

    it('toggleSubtask で未完了へ戻すと親も未完了へ戻る', () => {
        const parent = parentWith(
            [{ id: 's1', name: 'a', completed: true, completedAt: NOW, createdAt: NOW }],
            { completed: true, completedAt: NOW },
        );
        const result = toggleSubtask([parent], 'p1', 's1', NOW);
        expect(result?.completedSubtask).toBe(false);
        expect(result?.parentCompleted).toBe(false);
        expect(result?.tasks[0].completed).toBe(false);
        expect(result?.tasks[0].completedAt).toBeNull();
    });

    it('removeSubtaskFromTask で残りが全完了なら親を自動完了する', () => {
        const parent = parentWith([
            { id: 's1', name: 'a', completed: true, completedAt: NOW, createdAt: NOW },
            { id: 's2', name: 'b', completed: false, completedAt: null, createdAt: NOW },
        ]);
        const result = removeSubtaskFromTask([parent], 'p1', 's2', NOW);
        expect(result?.parentCompleted).toBe(true);
        expect(result?.tasks[0].completed).toBe(true);
        expect(result?.tasks[0].subtasks).toHaveLength(1);
    });

    it('removeSubtaskFromTask は不明サブタスクで null', () => {
        const parent = parentWith([]);
        expect(removeSubtaskFromTask([parent], 'p1', 'nope', NOW)).toBeNull();
    });
});
