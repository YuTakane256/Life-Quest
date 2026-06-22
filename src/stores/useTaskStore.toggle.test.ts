import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore } from './useTaskStore';
import { useGameStore } from './useGameStore';
import { useStatsStore } from './useStatsStore';
import { UI_CONFIG, XP_CONFIG } from '../config/gameConfig';

function resetStore() {
    localStorage.clear();
    useTaskStore.setState({ tasks: [], pendingCompletions: [] });
}

describe('useTaskStore.toggleComplete', () => {
    let addXpSpy: ReturnType<typeof vi.spyOn>;
    let incGachaSpy: ReturnType<typeof vi.spyOn>;
    let checkGachaSpy: ReturnType<typeof vi.spyOn>;
    let logTaskXpSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        resetStore();
        // useGameStore / useStatsStore の副作用を握りつぶす
        addXpSpy = vi.spyOn(useGameStore.getState(), 'addXp').mockImplementation(() => undefined);
        incGachaSpy = vi.spyOn(useGameStore.getState(), 'incrementGachaCount').mockImplementation(() => undefined);
        checkGachaSpy = vi.spyOn(useGameStore.getState(), 'checkGachaMilestones').mockImplementation(() => undefined);
        logTaskXpSpy = vi.spyOn(useStatsStore.getState(), 'logTaskXp').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /** ヘルパー: タスクを追加して id を返す */
    function seedTask(name = 'A', priority: 'low' | 'medium' | 'high' = 'medium', recurrence: 'none' | 'daily' | 'weekly' | 'monthly' = 'none', dueDate: string | null = null): string {
        useTaskStore.getState().addTask(name, dueDate, priority, recurrence);
        return useTaskStore.getState().tasks[0].id;
    }

    it('未完了タスク完了: pending に追加され、5秒前は addXp が呼ばれない', () => {
        const id = seedTask();
        useTaskStore.getState().toggleComplete(id);
        const state = useTaskStore.getState();
        const task = state.tasks.find((t) => t.id === id);
        expect(task?.completed).toBe(true);
        expect(task?.completedAt).toBeTruthy();
        expect(state.pendingCompletions).toHaveLength(1);
        expect(state.pendingCompletions[0].taskId).toBe(id);
        // まだ確定処理は走っていない
        expect(addXpSpy).not.toHaveBeenCalled();
    });

    it('5秒経過後: pending から消え、addXp/logTaskXp が呼ばれる', async () => {
        const id = seedTask('A', 'high');
        useTaskStore.getState().toggleComplete(id);
        await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);
        const state = useTaskStore.getState();
        expect(state.pendingCompletions).toHaveLength(0);
        expect(addXpSpy).toHaveBeenCalledWith(XP_CONFIG.REWARD_BY_PRIORITY.high);
        expect(incGachaSpy).toHaveBeenCalledTimes(1);
        expect(checkGachaSpy).toHaveBeenCalledTimes(1);
        expect(logTaskXpSpy).toHaveBeenCalled();
    });

    it('cancelPendingCompletion: pending から消え、確定処理は走らない', async () => {
        const id = seedTask();
        useTaskStore.getState().toggleComplete(id);
        useTaskStore.getState().cancelPendingCompletion(id);
        expect(useTaskStore.getState().pendingCompletions).toHaveLength(0);
        // 5秒経過しても addXp は呼ばれない
        await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);
        expect(addXpSpy).not.toHaveBeenCalled();
    });

    it('繰り返しタスクをUndoした場合、5秒後も次回分を生成しない', async () => {
        const id = seedTask('Daily undo', 'medium', 'daily', '2025-03-15');

        useTaskStore.getState().toggleComplete(id);
        useTaskStore.getState().cancelPendingCompletion(id);
        await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);

        const tasks = useTaskStore.getState().tasks;
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
            id,
            completed: false,
            completedAt: null,
        });
        expect(addXpSpy).not.toHaveBeenCalled();
    });

    it('Undo待ちのタスクにサブタスクを追加すると、完了タイマーをキャンセルして報酬を付与しない', async () => {
        const id = seedTask();

        useTaskStore.getState().toggleComplete(id);
        useTaskStore.getState().addSubtask(id, '追加の確認');
        await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);

        const task = useTaskStore.getState().tasks.find((t) => t.id === id);
        expect(task).toMatchObject({
            completed: false,
            completedAt: null,
        });
        expect(task?.subtasks.map((subtask) => subtask.name)).toEqual(['追加の確認']);
        expect(useTaskStore.getState().pendingCompletions).toHaveLength(0);
        expect(addXpSpy).not.toHaveBeenCalled();
    });

    it('完了済みタスクで toggleComplete: 即座に未完了に戻る（5秒待機なし）', () => {
        const id = seedTask();
        // 直接完了状態に
        useTaskStore.setState((s) => ({
            tasks: s.tasks.map((t) => t.id === id ? { ...t, completed: true, completedAt: '2025-01-01T00:00:00Z' } : t),
        }));
        useTaskStore.getState().toggleComplete(id);
        const task = useTaskStore.getState().tasks.find((t) => t.id === id);
        expect(task?.completed).toBe(false);
        expect(task?.completedAt).toBeNull();
        // pending には入らない
        expect(useTaskStore.getState().pendingCompletions).toHaveLength(0);
    });

    it('同じ未完了タスクで2回連続 toggleComplete: pending は1件のみ', () => {
        const id = seedTask();
        useTaskStore.getState().toggleComplete(id);
        useTaskStore.getState().toggleComplete(id);
        expect(useTaskStore.getState().pendingCompletions).toHaveLength(1);
    });

    it('繰り返しタスク(daily) を完了→5秒後に次回分が自動生成される', async () => {
        const id = seedTask('毎日タスク', 'medium', 'daily', '2025-03-15');
        useTaskStore.getState().toggleComplete(id);
        await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);
        const tasks = useTaskStore.getState().tasks;
        expect(tasks).toHaveLength(2);
        const next = tasks.find((t) => !t.completed);
        expect(next).toBeDefined();
        expect(next?.name).toBe('毎日タスク');
        expect(next?.dueDate).toBe('2025-03-16');
        expect(next?.recurrence).toBe('daily');
    });

    it('繰り返しタスク(monthly) は月末日をまたいでも次回分を生成する', async () => {
        const id = seedTask('月末タスク', 'medium', 'monthly', '2025-01-31');

        useTaskStore.getState().toggleComplete(id);
        await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);

        const next = useTaskStore.getState().tasks.find((t) => !t.completed);
        expect(next).toMatchObject({
            name: '月末タスク',
            recurrence: 'monthly',
            dueDate: '2025-02-28',
            completed: false,
            completedAt: null,
        });
    });

    it('繰り返しタスクの次回分ではサブタスクが未完了状態に戻る', async () => {
        useTaskStore.getState().addTask('Subtask recurring', '2025-03-15', 'medium', 'weekly', [], [
            {
                id: 'sub-1',
                name: '子',
                completed: true,
                completedAt: '2025-03-15T00:00:00.000Z',
                createdAt: '2025-03-15T00:00:00.000Z',
            },
        ]);
        const id = useTaskStore.getState().tasks[0].id;

        useTaskStore.getState().toggleComplete(id);
        await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);

        const next = useTaskStore.getState().tasks.find((t) => !t.completed);
        expect(next?.subtasks).toHaveLength(1);
        expect(next?.subtasks[0]).toMatchObject({
            name: '子',
            completed: false,
            completedAt: null,
        });
        expect(next?.subtasks[0].id).not.toBe('sub-1');
    });

    it('同名 + 同 dueDate の繰り返し次回分が既に存在すれば二重生成しない', async () => {
        const id = seedTask('Daily', 'medium', 'daily', '2025-03-15');
        // 既に次回分相当のタスクを手で1件入れておく
        useTaskStore.setState((s) => ({
            tasks: [
                ...s.tasks,
                {
                    id: 'already-next',
                    name: 'Daily',
                    dueDate: '2025-03-16',
                    priority: 'medium',
                    tags: [],
                    subtasks: [],
                    recurrence: 'daily',
                    completed: false,
                    completedAt: null,
                    createdAt: '2025-03-15T00:00:00Z',
                },
            ],
        }));
        useTaskStore.getState().toggleComplete(id);
        await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);
        const tasks = useTaskStore.getState().tasks;
        // 既存タスク + 元の完了タスク = 2 件、二重生成されない
        expect(tasks.filter((t) => !t.completed)).toHaveLength(1);
    });
});
