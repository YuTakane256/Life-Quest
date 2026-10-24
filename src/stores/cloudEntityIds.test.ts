import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: vi.fn(async () => true), isWebCloudOutboxActive: () => false }));
import { enqueueCloudOperation } from '../platform/cloudOutbox';
import { useTaskStore } from './useTaskStore';
import { useHabitStore } from './useHabitStore';
import { createMobileId } from '../../apps/mobile/src/utils/createMobileId';
import { createEntityId } from '@life-quest/core/entityId';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const enqueue = vi.mocked(enqueueCloudOperation);
beforeEach(() => {
    localStorage.clear();
    useTaskStore.setState({ tasks: [], pendingCompletions: [] });
    useHabitStore.setState({ habits: [], dailyRecords: [], restDays: [], allCompleteRewardDates: [] });
    enqueue.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('real store IDs sent to the UUID database boundary', () => {
    it('creates Web tasks/subtasks/habits with UUID IDs and sends the initial children', () => {
        const child = { id: createEntityId(), name: 'step', completed: false, completedAt: null, createdAt: new Date().toISOString() };
        useTaskStore.getState().addTask('task', '2026-10-26', 'high', 'none', ['sync'], [child]);
        const task = useTaskStore.getState().tasks[0];
        useHabitStore.getState().addHabit('habit');
        expect(task.id).toMatch(uuid);
        expect(useHabitStore.getState().habits[0].id).toMatch(uuid);
        expect(enqueue).toHaveBeenNthCalledWith(1, 'upsert_task', expect.objectContaining({ p_id: task.id }), { trackEntityId: task.id });
        expect(enqueue).toHaveBeenNthCalledWith(2, 'upsert_subtask', { p_id: child.id, p_task_id: task.id, p_name: 'step' }, { dependsOnEntityIds: [task.id], trackEntityId: child.id });
        useTaskStore.getState().addSubtask(task.id, 'inline');
        const duplicate = useTaskStore.getState().duplicateTask(task.id);
        const copied = useTaskStore.getState().tasks.find((item) => item.id === duplicate)!;
        expect(copied.id).toMatch(uuid);
        expect(copied.subtasks.every((item) => uuid.test(item.id))).toBe(true);
    });
    it('supports the Native helper without a global crypto implementation', () => {
        vi.stubGlobal('crypto', undefined);
        expect(createMobileId()).toMatch(uuid);
        useTaskStore.getState().addTask('fallback', null, 'medium', 'none');
        expect(useTaskStore.getState().tasks[0].id).toMatch(uuid);
    });
    it('does not rewrite existing saved IDs while creating another task', () => {
        useTaskStore.setState({ tasks: [{ id: 'legacy-local-id', name: 'old', dueDate: null, priority: 'medium', recurrence: 'none', tags: [], subtasks: [], completed: false, completedAt: null, createdAt: new Date().toISOString() }] });
        useTaskStore.getState().addTask('new', null, 'medium', 'none');
        expect(useTaskStore.getState().tasks[0].id).toBe('legacy-local-id');
        expect(useTaskStore.getState().tasks[1].id).toMatch(uuid);
    });
});
