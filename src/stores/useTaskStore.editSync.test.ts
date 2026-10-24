import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { useTaskStore } from './useTaskStore';
import { useGameStore } from './useGameStore';
import { useStatsStore } from './useStatsStore';
import { enqueueCloudOperation } from '../platform/cloudOutbox';
import type { Subtask, Task } from '../types';

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async () => true), isWebCloudOutboxActive: () => false,
}));
const enqueue = vi.mocked(enqueueCloudOperation);
const child = (id: string, completed = false): Subtask => ({
    id, name: id, completed, completedAt: completed ? '2026-10-25T00:00:00.000Z' : null,
    createdAt: '2026-10-24T00:00:00.000Z',
});
function seed(subtasks: Subtask[], overrides: Partial<Task> = {}) {
    const task: Task = { id: 'parent', name: 'parent', dueDate: null, priority: 'medium', recurrence: 'daily',
        tags: [], subtasks, completed: false, completedAt: null, createdAt: '2026-10-24T00:00:00.000Z', ...overrides };
    useTaskStore.setState({ tasks: [task], pendingCompletions: [] });
    return task;
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await vi.dynamicImportSettled(); };
const operations = () => enqueue.mock.calls.map(([operation]) => operation);

beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('account-a');
    setGameRewardAuthorityState('authenticated');
    localStorage.clear(); useTaskStore.setState({ tasks: [], pendingCompletions: [] });
    enqueue.mockReset(); enqueue.mockResolvedValue(true);
    vi.spyOn(useGameStore.getState(), 'addXp').mockImplementation(() => undefined);
    vi.spyOn(useGameStore.getState(), 'incrementGachaCount').mockImplementation(() => undefined);
    vi.spyOn(useGameStore.getState(), 'grantCompletionReward').mockResolvedValue(true);
    vi.spyOn(useStatsStore.getState(), 'logTaskXp').mockImplementation(() => undefined);
});
afterEach(async () => { await flush(); resetAuthLifecycleHooks(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Web task form subtask synchronization', () => {
    it('queues only added/renamed/deleted children and keeps completion metadata', async () => {
        const task = seed([child('kept', true), child('rename', true), child('removed')]);
        useTaskStore.getState().updateTask(task.id, { name: 'edited', subtasks: [task.subtasks[0],
            { ...task.subtasks[1], name: 'renamed' }, child('added')] });
        await flush();
        expect(operations()).toEqual(['upsert_task', 'upsert_subtask', 'upsert_subtask', 'delete_subtask']);
        expect(enqueue).toHaveBeenCalledWith('upsert_subtask', { p_id: 'rename', p_task_id: task.id, p_name: 'renamed' },
            { dependsOnEntityIds: [task.id, 'rename'], trackEntityId: 'rename' });
        expect(enqueue).toHaveBeenCalledWith('delete_subtask', { p_id: 'removed' },
            { dependsOnEntityIds: [task.id, 'removed'], trackEntityId: 'removed' });
        expect(useTaskStore.getState().tasks[0].subtasks[1]).toEqual({ ...task.subtasks[1], name: 'renamed' });
        expect(useGameStore.getState().addXp).not.toHaveBeenCalled();
    });
    it('unchanged children and parent-only edits do not send child operations', async () => {
        const task = seed([child('kept')]);
        useTaskStore.getState().updateTask(task.id, { subtasks: task.subtasks });
        useTaskStore.getState().updateTask(task.id, { name: 'parent only' });
        await flush(); expect(operations()).toEqual(['upsert_task', 'upsert_task']);
    });
    it('replacing the last open child does not transiently complete or reward a recurring task', async () => {
        const task = seed([child('done', true), child('open')]);
        useTaskStore.getState().updateTask(task.id, { subtasks: [task.subtasks[0], child('replacement')] });
        await flush();
        expect(operations()).toEqual(['upsert_task', 'upsert_subtask', 'delete_subtask']);
        expect(useTaskStore.getState().tasks).toHaveLength(1);
        expect(useTaskStore.getState().tasks[0].completed).toBe(false);
        expect(useGameStore.getState().addXp).not.toHaveBeenCalled();
    });
    it('removing all children does not complete the parent', async () => {
        seed([child('done', true), child('open')]);
        useTaskStore.getState().updateTask('parent', { subtasks: [] }); await flush();
        expect(operations()).toEqual(['upsert_task', 'delete_subtask', 'delete_subtask']);
        expect(useTaskStore.getState().tasks[0].completed).toBe(false);
    });
    it('finishes child deletion before confirming the parent, and a repeated save gives no extra reward', async () => {
        const task = seed([child('done', true), child('open')]);
        useTaskStore.getState().updateTask(task.id, { subtasks: [task.subtasks[0]] }); await flush();
        expect(operations()).toEqual(['upsert_task', 'delete_subtask', 'complete_task']);
        expect(enqueue).toHaveBeenLastCalledWith('complete_task', { taskId: task.id }, { dependsOnEntityIds: [task.id, 'open'] });
        useTaskStore.getState().updateTask(task.id, { subtasks: [task.subtasks[0]] }); await flush();
        expect(operations().filter((op) => op === 'complete_task')).toHaveLength(1);
        expect(useGameStore.getState().addXp).toHaveBeenCalledTimes(1);
        expect(useTaskStore.getState().tasks).toHaveLength(1); // Server owns recurring generation while signed in.
    });
    it('adding an open child to a completed parent sends uncomplete_task', async () => {
        const task = seed([child('done', true)], { completed: true, completedAt: '2026-10-25T00:00:00.000Z' });
        useTaskStore.getState().updateTask(task.id, { subtasks: [...task.subtasks, child('open')] }); await flush();
        expect(operations()).toEqual(['upsert_task', 'upsert_subtask', 'uncomplete_task']);
        expect(useTaskStore.getState().tasks[0].completed).toBe(false);
    });
    it('cancels pending Undo before editing without sending an uncomplete for an unsent completion', async () => {
        vi.useFakeTimers(); const task = seed([]);
        useTaskStore.getState().toggleComplete(task.id);
        useTaskStore.getState().updateTask(task.id, { subtasks: [child('open')] });
        await flush(); await vi.advanceTimersByTimeAsync(6000);
        expect(operations()).toEqual(['upsert_task', 'upsert_subtask']);
        expect(useTaskStore.getState().pendingCompletions).toEqual([]);
        expect(useGameStore.getState().addXp).not.toHaveBeenCalled();
    });
    it.each(['logout', 'account-switch', 'delete', 'not-accepted'])('stops deferred children after %s', async (action) => {
        seed([]); let release!: (accepted: boolean) => void;
        enqueue.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve; }));
        useTaskStore.getState().updateTask('parent', { subtasks: [child('new')] });
        if (action === 'logout') await notifyLogout();
        if (action === 'account-switch') await notifyLogin('account-b');
        if (action === 'delete') useTaskStore.setState({ tasks: [] });
        release(action !== 'not-accepted'); await flush();
        expect(operations()).toEqual(['upsert_task']);
    });
    it('orders two rapid saves so removal follows the delayed addition', async () => {
        seed([]); let release!: (accepted: boolean) => void;
        enqueue.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve; }));
        useTaskStore.getState().updateTask('parent', { subtasks: [child('new')] });
        useTaskStore.getState().updateTask('parent', { subtasks: [] });
        await flush(); expect(operations()).toEqual(['upsert_task', 'upsert_task']);
        release(true); await flush();
        expect(operations()).toEqual(['upsert_task', 'upsert_task', 'upsert_subtask', 'delete_subtask']);
        expect(useTaskStore.getState().tasks[0].subtasks).toEqual([]);
    });
    it('does not send a deferred completion after Undo during the queue write', async () => {
        const task = seed([child('done', true), child('open')]);
        let release!: (accepted: boolean) => void;
        enqueue.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve; }));
        useTaskStore.getState().updateTask(task.id, { subtasks: [task.subtasks[0]] });
        useTaskStore.getState().toggleComplete(task.id);
        release(true); await flush();
        expect(operations()).not.toContain('complete_task');
    });
    it('anonymous completion uses the receipt ledger and generates one next recurring task', async () => {
        setGameRewardAuthorityState('anonymous'); enqueue.mockResolvedValue(false);
        const task = seed([child('done', true), child('open')]);
        useTaskStore.getState().updateTask(task.id, { subtasks: [task.subtasks[0]] }); await flush();
        useTaskStore.getState().updateTask(task.id, { subtasks: [task.subtasks[0]] }); await flush();
        expect(useGameStore.getState().grantCompletionReward).toHaveBeenCalledTimes(1);
        expect(useGameStore.getState().grantCompletionReward).toHaveBeenCalledWith('task:parent', 20, expect.any(Number));
        expect(useTaskStore.getState().tasks).toHaveLength(2);
    });
});
