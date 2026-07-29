import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore } from './useTaskStore';
import { useGameStore } from './useGameStore';
import { useStatsStore } from './useStatsStore';
import { UI_CONFIG } from '../config/gameConfig';
import { enqueueCloudOperation } from '../platform/cloudOutbox';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import {
    clearPendingWebRewardOperations,
    detachPendingWebRewardOperations,
    getPendingWebRewardOperations,
} from '../platform/pendingRewardOperations';

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async () => true),
    isWebCloudOutboxActive: vi.fn(() => false),
}));

const enqueueMock = vi.mocked(enqueueCloudOperation);

function resetStore() {
    setGameRewardAuthorityState('anonymous');
    clearPendingWebRewardOperations();
    localStorage.clear();
    useTaskStore.setState({ tasks: [], pendingCompletions: [] });
}

describe('useTaskStore クラウド同期の配線', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetStore();
        enqueueMock.mockClear();
        vi.spyOn(useGameStore.getState(), 'addXp').mockImplementation(() => undefined);
        vi.spyOn(useGameStore.getState(), 'incrementGachaCount').mockImplementation(() => undefined);
        vi.spyOn(useGameStore.getState(), 'checkGachaMilestones').mockImplementation(() => undefined);
        vi.spyOn(useStatsStore.getState(), 'logTaskXp').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('addTaskはupsert_taskをenqueueする', () => {
        useTaskStore.getState().addTask('買い物', '2026-07-20', 'high', 'daily', ['tag1']);
        const task = useTaskStore.getState().tasks[0];

        expect(enqueueMock).toHaveBeenCalledWith('upsert_task', {
            p_id: task.id,
            p_name: '買い物',
            p_due_date: '2026-07-20',
            p_priority: 'high',
            p_recurrence: 'daily',
            p_tags: ['tag1'],
        }, { trackEntityId: task.id });
    });

    it('deleteTaskはdelete_taskをenqueueする', () => {
        useTaskStore.getState().addTask('削除対象', null, 'medium', 'none');
        const id = useTaskStore.getState().tasks[0].id;
        enqueueMock.mockClear();

        useTaskStore.getState().deleteTask(id);

        expect(enqueueMock).toHaveBeenCalledWith('delete_task', { p_id: id }, { dependsOnEntityIds: [id] });
    });

    it('5秒経過後の完了確定でcomplete_taskがenqueueされる', async () => {
        useTaskStore.getState().addTask('完了対象', null, 'medium', 'none');
        const id = useTaskStore.getState().tasks[0].id;
        enqueueMock.mockClear();

        useTaskStore.getState().toggleComplete(id);
        expect(enqueueMock).not.toHaveBeenCalled(); // Undo待機中はまだ送らない

        await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);
        expect(enqueueMock).toHaveBeenCalledWith('complete_task', { taskId: id }, { dependsOnEntityIds: [id] });
    });

    it('Webでもresolving中は報酬を確定せず、anonymous確定後に保留分を適用する', async () => {
        const { registerWebPendingTaskRewardRecovery } = await import('./useTaskStore');
        const stop = registerWebPendingTaskRewardRecovery();
        try {
            setGameRewardAuthorityState('resolving');
            useTaskStore.getState().addTask('復元中の完了', null, 'medium', 'none');
            const id = useTaskStore.getState().tasks[0].id;
            useTaskStore.getState().toggleComplete(id);
            useTaskStore.getState().flushPendingCompletions();
            await Promise.resolve();
            await Promise.resolve();

            expect(useGameStore.getState().addXp).not.toHaveBeenCalled();
            expect(useGameStore.getState().incrementGachaCount).not.toHaveBeenCalled();

            setGameRewardAuthorityState('anonymous');
            await vi.dynamicImportSettled();
            expect(useGameStore.getState().addXp).toHaveBeenCalledWith(20);
            expect(useGameStore.getState().incrementGachaCount).toHaveBeenCalledTimes(1);
        } finally {
            stop();
        }
    });

    it('Webの復元中繰り返しタスクはanonymous確定後に一度だけ次回分を生成する', async () => {
        const { registerWebPendingTaskRewardRecovery } = await import('./useTaskStore');
        const stop = registerWebPendingTaskRewardRecovery();
        try {
            setGameRewardAuthorityState('resolving');
            useTaskStore.getState().addTask('復元中の毎日タスク', null, 'medium', 'daily');
            const id = useTaskStore.getState().tasks[0].id;
            useTaskStore.getState().toggleComplete(id);
            useTaskStore.getState().flushPendingCompletions();
            await vi.dynamicImportSettled();
            expect(useTaskStore.getState().tasks).toHaveLength(1);
            expect(enqueueMock).not.toHaveBeenCalledWith('complete_task', { taskId: id }, { dependsOnEntityIds: [id] });

            setGameRewardAuthorityState('anonymous');
            await vi.dynamicImportSettled();
            expect(useTaskStore.getState().tasks).toHaveLength(2);

            setGameRewardAuthorityState('anonymous');
            expect(useTaskStore.getState().tasks).toHaveLength(2);
        } finally {
            stop();
        }
    });

    it('Webの復元中繰り返しタスクはauthenticated確定後に保留操作だけを送り、ローカル次回分を作らない', async () => {
        const { registerWebPendingTaskRewardRecovery } = await import('./useTaskStore');
        const stop = registerWebPendingTaskRewardRecovery();
        try {
            setGameRewardAuthorityState('resolving');
            useTaskStore.getState().addTask('クラウド復元中の毎日タスク', null, 'medium', 'daily');
            const id = useTaskStore.getState().tasks[0].id;
            enqueueMock.mockClear();
            useTaskStore.getState().toggleComplete(id);
            useTaskStore.getState().flushPendingCompletions();
            await vi.dynamicImportSettled();

            setGameRewardAuthorityState('authenticated');
            await vi.dynamicImportSettled();
            await vi.waitFor(() => expect(getPendingWebRewardOperations()).toEqual([]));
            expect(useTaskStore.getState().tasks).toHaveLength(1);
            expect(enqueueMock).toHaveBeenCalledTimes(1);
            expect(enqueueMock).toHaveBeenCalledWith('complete_task', { taskId: id }, { dependsOnEntityIds: [id] });
        } finally {
            stop();
        }
    });

    it('Webはoutbox enqueue失敗時に保留操作を残す', async () => {
        const { registerWebPendingTaskRewardRecovery } = await import('./useTaskStore');
        const stop = registerWebPendingTaskRewardRecovery();
        try {
            setGameRewardAuthorityState('resolving');
            useTaskStore.getState().addTask('失敗する復元操作', null, 'medium', 'none');
            const id = useTaskStore.getState().tasks[0].id;
            enqueueMock.mockClear();
            useTaskStore.getState().toggleComplete(id);
            useTaskStore.getState().flushPendingCompletions();
            await vi.dynamicImportSettled();
            enqueueMock.mockResolvedValueOnce(false);

            setGameRewardAuthorityState('authenticated');
            await vi.dynamicImportSettled();
            expect(getPendingWebRewardOperations().map((operation) => operation.key)).toEqual([`task:${id}`]);
        } finally {
            stop();
        }
    });

    it('Webのログアウト起因anonymous遷移は直前userの保留操作をローカル報酬にしない', async () => {
        const { registerWebPendingTaskRewardRecovery } = await import('./useTaskStore');
        const stop = registerWebPendingTaskRewardRecovery();
        try {
            setGameRewardAuthorityState('resolving');
            useTaskStore.getState().addTask('ログアウト前の保留操作', null, 'medium', 'none');
            const id = useTaskStore.getState().tasks[0].id;
            useTaskStore.getState().toggleComplete(id);
            useTaskStore.getState().flushPendingCompletions();
            await vi.dynamicImportSettled();
            expect(getPendingWebRewardOperations().map((operation) => operation.key)).toEqual([`task:${id}`]);

            detachPendingWebRewardOperations();
            setGameRewardAuthorityState('anonymous');
            await vi.dynamicImportSettled();

            expect(getPendingWebRewardOperations()).toEqual([]);
            expect(useGameStore.getState().addXp).not.toHaveBeenCalled();
        } finally {
            stop();
        }
    });

    it('Undo待機中の取消はcomplete_task/uncomplete_taskいずれも送らない', () => {
        useTaskStore.getState().addTask('取消対象', null, 'medium', 'none');
        const id = useTaskStore.getState().tasks[0].id;
        enqueueMock.mockClear();

        useTaskStore.getState().toggleComplete(id); // 完了→待機
        useTaskStore.getState().toggleComplete(id); // 待機中に取消
        expect(enqueueMock).not.toHaveBeenCalled();
    });

    it('確定後の取消（uncomplete）はuncomplete_taskをenqueueする', async () => {
        useTaskStore.getState().addTask('確定後取消', null, 'medium', 'none');
        const id = useTaskStore.getState().tasks[0].id;
        useTaskStore.getState().toggleComplete(id);
        await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);
        enqueueMock.mockClear();

        useTaskStore.getState().toggleComplete(id);

        expect(enqueueMock).toHaveBeenCalledWith('uncomplete_task', { p_id: id }, { dependsOnEntityIds: [id] });
    });

    it('addSubtaskはupsert_subtaskをenqueueする', () => {
        useTaskStore.getState().addTask('親タスク', null, 'medium', 'none');
        const taskId = useTaskStore.getState().tasks[0].id;
        enqueueMock.mockClear();

        useTaskStore.getState().addSubtask(taskId, '子タスク');
        const subtask = useTaskStore.getState().tasks[0].subtasks[0];

        expect(enqueueMock).toHaveBeenCalledWith(
            'upsert_subtask',
            { p_id: subtask.id, p_task_id: taskId, p_name: '子タスク' },
            { dependsOnEntityIds: [taskId], trackEntityId: subtask.id },
        );
    });

    it('deleteSubtaskはdelete_subtaskをenqueueする（親自動完了時はcomplete_taskも）', () => {
        useTaskStore.getState().addTask('親タスク', null, 'medium', 'none');
        const taskId = useTaskStore.getState().tasks[0].id;
        useTaskStore.getState().addSubtask(taskId, '子1');
        useTaskStore.getState().addSubtask(taskId, '子2');
        const [sub1, sub2] = useTaskStore.getState().tasks[0].subtasks;
        useTaskStore.getState().toggleSubtaskComplete(taskId, sub1.id); // 子1のみ完了
        enqueueMock.mockClear();

        useTaskStore.getState().deleteSubtask(taskId, sub2.id); // 残りが全完了→親も自動完了

        expect(enqueueMock).toHaveBeenCalledWith('delete_subtask', { p_id: sub2.id }, { dependsOnEntityIds: [sub2.id] });
        expect(enqueueMock).toHaveBeenCalledWith('complete_task', { taskId }, { dependsOnEntityIds: [taskId, sub2.id] });
    });

    it('toggleSubtaskCompleteはcomplete_subtask/uncomplete_subtaskをenqueueする', () => {
        useTaskStore.getState().addTask('親タスク', null, 'medium', 'none');
        const taskId = useTaskStore.getState().tasks[0].id;
        useTaskStore.getState().addSubtask(taskId, '子1');
        const subtaskId = useTaskStore.getState().tasks[0].subtasks[0].id;
        enqueueMock.mockClear();

        useTaskStore.getState().toggleSubtaskComplete(taskId, subtaskId);
        expect(enqueueMock).toHaveBeenCalledWith(
            'complete_subtask', { subtaskId }, { dependsOnEntityIds: [subtaskId, taskId] },
        );

        enqueueMock.mockClear();
        useTaskStore.getState().toggleSubtaskComplete(taskId, subtaskId);
        expect(enqueueMock).toHaveBeenCalledWith(
            'uncomplete_subtask', { p_id: subtaskId }, { dependsOnEntityIds: [subtaskId] },
        );
    });

    it('duplicateTaskはupsert_task+upsert_subtaskをenqueueする', () => {
        useTaskStore.getState().addTask('元タスク', null, 'medium', 'none');
        const sourceId = useTaskStore.getState().tasks[0].id;
        useTaskStore.getState().addSubtask(sourceId, '子1');
        enqueueMock.mockClear();

        const duplicateId = useTaskStore.getState().duplicateTask(sourceId);
        expect(duplicateId).not.toBeNull();

        const calledOperations = enqueueMock.mock.calls.map((call) => call[0]);
        expect(calledOperations).toContain('upsert_task');
        expect(calledOperations).toContain('upsert_subtask');
    });
});
