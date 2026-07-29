/**
 * #505 Mobileタスク操作のクラウド同期フィデリティテスト。
 * 「nameだけのupsertでpriority/dueDate/tags/recurrenceが落ちる」
 * 「完了・取消・サブタスク操作が送信されない」
 * 「クラウド有効時の繰り返しローカル二重生成」の各欠落パターンを再現して検証する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';

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
import { useMobileGameStore } from './useMobileGameStore';
import { clearPendingRewardOperations } from '../platform/pendingRewardOperations';

function ops(operation: string) {
    return enqueued.filter((entry) => entry.operation === operation);
}

describe('Mobileタスク操作のクラウド同期（#505/#512）', () => {
    let rewardCalls: string[];

    beforeEach(() => {
        vi.useFakeTimers();
        enqueued.length = 0;
        rewardCalls = [];
        cloudActive = true;
        setGameRewardAuthorityState('authenticated');
        clearPendingRewardOperations();
        useMobileTaskStore.setState({ tasks: [], pendingCompletions: [], hasHydrated: true });
        // 報酬付与の回数を数える（実ロジックは走らせない）
        useMobileGameStore.setState({
            grantTaskCompletionReward: (taskId: string) => { rewardCalls.push(taskId); return true; },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
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

    it('完了は5秒のUndo猶予後にcomplete_taskとして確定送信される（#512）', () => {
        useMobileTaskStore.getState().addTask('完了対象');
        const taskId = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().toggleTask(taskId); // 完了（待機開始）
        expect(useMobileTaskStore.getState().tasks[0].completed).toBe(true); // 表示は即時
        expect(ops('complete_task')).toHaveLength(0); // まだ送らない
        expect(rewardCalls).toHaveLength(0);          // 報酬もまだ

        vi.advanceTimersByTime(5000); // Undo猶予経過 → 確定
        expect(ops('complete_task')).toHaveLength(1);
        expect(ops('complete_task')[0].payload).toEqual({ taskId });
        expect(rewardCalls).toEqual([taskId]);

        useMobileTaskStore.getState().toggleTask(taskId); // 確定後の取消
        expect(ops('uncomplete_task')).toHaveLength(1);
        expect(ops('uncomplete_task')[0].payload).toEqual({ p_id: taskId });
    });

    it('5秒以内の取消では報酬もcomplete_taskも一切発生しない（#512の受け入れ条件）', () => {
        useMobileTaskStore.getState().addTask('取消対象');
        const taskId = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().toggleTask(taskId);
        const cancelled = useMobileTaskStore.getState().cancelPendingCompletion(taskId);
        expect(cancelled).toBe(true);
        expect(useMobileTaskStore.getState().tasks[0].completed).toBe(false);

        vi.advanceTimersByTime(10_000); // 猶予経過後も何も起きない
        expect(ops('complete_task')).toHaveLength(0);
        expect(ops('uncomplete_task')).toHaveLength(0); // 未送信の取消なのでRPC不要
        expect(rewardCalls).toHaveLength(0);
    });

    it('flushPendingCompletionsは待機中の完了を即時確定する（バックグラウンド遷移時）', () => {
        useMobileTaskStore.getState().addTask('flush対象');
        const taskId = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().toggleTask(taskId);
        useMobileTaskStore.getState().flushPendingCompletions();

        expect(ops('complete_task')).toHaveLength(1);
        expect(rewardCalls).toEqual([taskId]);
        vi.advanceTimersByTime(10_000); // 元のタイマーが二重確定しない
        expect(ops('complete_task')).toHaveLength(1);
        expect(rewardCalls).toHaveLength(1);
    });

    it('編集はupsert_taskへ全項目（名前/期限/優先度/タグ）を載せて送る（#512）', () => {
        useMobileTaskStore.getState().addTask('編集前', 'low');
        const taskId = useMobileTaskStore.getState().tasks[0].id;
        enqueued.length = 0;

        useMobileTaskStore.getState().updateTask(taskId, {
            name: '編集後',
            priority: 'high',
            dueDate: '2026-07-20',
            tags: ['重要'],
        });

        expect(useMobileTaskStore.getState().tasks[0]).toMatchObject({ name: '編集後', priority: 'high' });
        expect(ops('upsert_task')[0].payload).toMatchObject({
            p_id: taskId, p_name: '編集後', p_due_date: '2026-07-20', p_priority: 'high', p_tags: ['重要'],
        });
    });

    it('複製は新IDのupsert_taskとサブタスクのupsert_subtaskを送る（#512）', () => {
        useMobileTaskStore.getState().addTask('複製元', 'high', { dueDate: '2026-07-15' });
        const sourceId = useMobileTaskStore.getState().tasks[0].id;
        useMobileTaskStore.getState().addSubtask(sourceId, '子');
        enqueued.length = 0;

        const newId = useMobileTaskStore.getState().duplicateTask(sourceId);
        expect(newId).not.toBeNull();
        expect(newId).not.toBe(sourceId);

        const upsert = ops('upsert_task')[0].payload;
        expect(upsert.p_id).toBe(newId);
        expect(upsert.p_priority).toBe('high');
        const subtaskUpsert = ops('upsert_subtask')[0].payload;
        expect(subtaskUpsert.p_task_id).toBe(newId);
        expect(subtaskUpsert.p_name).toBe('子');
    });

    it('一括削除はUndo待機中を除外し、削除した分だけdelete_taskを送る（#512）', () => {
        const store = useMobileTaskStore.getState();
        store.addTask('確定済み完了');
        store.addTask('待機中完了');
        store.addTask('未完了');
        const [doneId, pendingId] = useMobileTaskStore.getState().tasks.map((task) => task.id);

        useMobileTaskStore.getState().toggleTask(doneId);
        vi.advanceTimersByTime(5000); // 確定
        useMobileTaskStore.getState().toggleTask(pendingId); // 待機中のまま
        enqueued.length = 0;

        const removed = useMobileTaskStore.getState().deleteCompletedTasks();
        expect(removed).toBe(1); // 確定済みの1件のみ
        expect(ops('delete_task').map((entry) => entry.payload)).toEqual([{ p_id: doneId }]);
        const remainingIds = useMobileTaskStore.getState().tasks.map((task) => task.id);
        expect(remainingIds).toContain(pendingId); // 待機中は残る
    });

    it('クラウド有効時は繰り返し次回分をローカル生成しない（サーバー生成との二重防止）', () => {
        useMobileTaskStore.getState().addTask('毎日タスク', 'medium', { recurrence: 'daily', dueDate: '2026-07-06' });
        const taskId = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().toggleTask(taskId);
        vi.advanceTimersByTime(5000); // Undo猶予後に確定
        expect(useMobileTaskStore.getState().tasks).toHaveLength(1); // ローカル生成なし
        expect(ops('complete_task')).toHaveLength(1); // サーバーが次回分を生成する
    });

    it('クラウド無効（未ログイン）時は従来どおりローカルで繰り返し次回分を生成する', () => {
        cloudActive = false;
        setGameRewardAuthorityState('anonymous');
        useMobileTaskStore.getState().addTask('毎日タスク', 'medium', { recurrence: 'daily', dueDate: '2026-07-06' });
        const taskId = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().toggleTask(taskId);
        vi.advanceTimersByTime(5000); // Undo猶予後に確定
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
