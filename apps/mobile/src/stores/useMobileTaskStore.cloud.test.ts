/**
 * #505 Mobileタスク操作のクラウド同期フィデリティテスト。
 * 「nameだけのupsertでpriority/dueDate/tags/recurrenceが落ちる」
 * 「完了・取消・サブタスク操作が送信されない」
 * 「クラウド有効時の繰り返しローカル二重生成」の各欠落パターンを再現して検証する。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => { memory.set(key, value); }),
        removeItem: vi.fn(async (key: string) => { memory.delete(key); }),
    },
}));

const enqueued: { operation: string; payload: Record<string, unknown> }[] = [];
let cloudActive = true;

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async (operation: string, payload: Record<string, unknown>) => {
        if (!cloudActive) return false;
        enqueued.push({ operation, payload });
        return true;
    }),
    isCloudOutboxActive: vi.fn(() => cloudActive),
}));

import { useMobileTaskStore } from './useMobileTaskStore';

function ops(operation: string) {
    return enqueued.filter((entry) => entry.operation === operation);
}

describe('Mobileタスク操作のクラウド同期（#505）', () => {
    beforeEach(() => {
        enqueued.length = 0;
        cloudActive = true;
        useMobileTaskStore.setState({ tasks: [], hasHydrated: true });
    });

    it('addTaskはWeb仕様と同じ情報量（priority/dueDate/tags/recurrence）を送る', () => {
        useMobileTaskStore.getState().addTask('買い物', 'high', {
            dueDate: '2026-07-10',
            tags: ['家事', '重要'],
            recurrence: 'weekly',
        });
        expect(ops('upsert_task')).toHaveLength(1);
        const payload = ops('upsert_task')[0].payload;
        expect(payload).toMatchObject({
            p_name: '買い物',
            p_due_date: '2026-07-10',
            p_priority: 'high',
            p_recurrence: 'weekly',
            p_tags: ['家事', '重要'],
        });
    });

    it('完了はcomplete_task、取消はuncomplete_taskとして送られる', () => {
        const store = useMobileTaskStore.getState();
        store.addTask('完了対象');
        const taskId = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().toggleTask(taskId); // 完了
        expect(ops('complete_task')).toHaveLength(1);
        expect(ops('complete_task')[0].payload).toEqual({ taskId });

        useMobileTaskStore.getState().toggleTask(taskId); // 取消
        expect(ops('uncomplete_task')).toHaveLength(1);
        expect(ops('uncomplete_task')[0].payload).toEqual({ p_id: taskId });
    });

    it('クラウド有効時は繰り返し次回分をローカル生成しない（サーバー生成との二重防止）', () => {
        useMobileTaskStore.getState().addTask('毎日タスク', 'medium', { recurrence: 'daily', dueDate: '2026-07-06' });
        const taskId = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().toggleTask(taskId);
        expect(useMobileTaskStore.getState().tasks).toHaveLength(1); // ローカル生成なし
        expect(ops('complete_task')).toHaveLength(1); // サーバーが次回分を生成する
    });

    it('クラウド無効（未ログイン）時は従来どおりローカルで繰り返し次回分を生成する', () => {
        cloudActive = false;
        useMobileTaskStore.getState().addTask('毎日タスク', 'medium', { recurrence: 'daily', dueDate: '2026-07-06' });
        const taskId = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().toggleTask(taskId);
        expect(useMobileTaskStore.getState().tasks).toHaveLength(2); // ローカル生成あり
    });

    it('サブタスクの追加・完了・取消・削除が全て送信される', () => {
        useMobileTaskStore.getState().addTask('親');
        const taskId = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().addSubtask(taskId, '子');
        const subtaskId = useMobileTaskStore.getState().tasks[0].subtasks[0].id;
        expect(ops('upsert_subtask')[0].payload).toMatchObject({ p_id: subtaskId, p_task_id: taskId, p_name: '子' });

        useMobileTaskStore.getState().toggleSubtaskComplete(taskId, subtaskId); // 完了
        expect(ops('complete_subtask')[0].payload).toEqual({ subtaskId });

        useMobileTaskStore.getState().toggleSubtaskComplete(taskId, subtaskId); // 取消
        expect(ops('uncomplete_subtask')[0].payload).toEqual({ p_id: subtaskId });

        useMobileTaskStore.getState().deleteSubtask(taskId, subtaskId);
        expect(ops('delete_subtask')[0].payload).toEqual({ p_id: subtaskId });
    });

    it('未完了サブタスクの削除で親が完了した場合、親のcomplete_taskも送られる', () => {
        useMobileTaskStore.getState().addTask('親');
        const taskId = useMobileTaskStore.getState().tasks[0].id;
        useMobileTaskStore.getState().addSubtask(taskId, '子1');
        useMobileTaskStore.getState().addSubtask(taskId, '子2');
        const [sub1, sub2] = useMobileTaskStore.getState().tasks[0].subtasks.map((subtask) => subtask.id);

        useMobileTaskStore.getState().toggleSubtaskComplete(taskId, sub1); // 子1完了
        useMobileTaskStore.getState().deleteSubtask(taskId, sub2);         // 残り全完了→親完了

        expect(ops('delete_subtask')).toHaveLength(1);
        // サーバーのdelete_subtaskは親完了まで連鎖しないため、明示的にcomplete_taskが送られる
        expect(ops('complete_task').map((entry) => entry.payload)).toContainEqual({ taskId });
    });
});
