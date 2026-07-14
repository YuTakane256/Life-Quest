import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    addSubtaskToTask,
    buildNextRecurringTask,
    createTask,
    duplicateTask as duplicateTaskCore,
    getSubtaskRewardXp,
    hasOpenRecurringDuplicate,
    removeCompletedTasks,
    removeSubtaskFromTask,
    removeTask,
    sanitizeTaskCollection,
    TASK_LIMITS,
    TASK_UNDO_DURATION_MS,
    toggleSubtask,
    toggleTaskCompletion,
    updateTaskFields,
    type Task,
    type TaskFieldUpdates,
    type Priority,
    type Recurrence,
} from '@life-quest/core/tasks';
import { XP_CONFIG } from '@life-quest/core/progression';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createMobileId } from '../utils/createMobileId';
import { getTodayJst, toIsoDatePart } from '../utils/date';
import { useMobileGameStore } from './useMobileGameStore';
import { useMobileStatsStore } from './useMobileStatsStore';
import { enqueueCloudOperation, isCloudOutboxActive } from '../platform/cloudOutbox';

export interface AddTaskOptions {
    dueDate?: string | null;
    tags?: string[];
    recurrence?: Recurrence;
}

export interface MobilePendingCompletion {
    taskId: string;
    timeoutId: ReturnType<typeof setTimeout>;
    completedAt: string;
}

interface MobileTaskStore {
    tasks: Task[];
    hasHydrated: boolean;
    /** 5秒Undo待機中の完了（非永続。タイマーは復元不可能なため保存しない） */
    pendingCompletions: MobilePendingCompletion[];
    addTask: (name: string, priority?: Priority, options?: AddTaskOptions) => boolean;
    toggleTask: (taskId: string) => void;
    /** Undo待機中の完了を取り消す（UIの「取消」ボタン用）。取り消せたらtrue */
    cancelPendingCompletion: (taskId: string) => boolean;
    /** 待機中の完了を全て即時確定する（バックグラウンド遷移時の取りこぼし防止） */
    flushPendingCompletions: () => void;
    updateTask: (taskId: string, updates: TaskFieldUpdates) => void;
    /** タスクを複製し、新IDを返す（上限到達・元なしはnull） */
    duplicateTask: (taskId: string) => string | null;
    deleteTask: (taskId: string) => void;
    /** 完了済みタスクをまとめて削除（Undo待機中は除外）。削除件数を返す */
    deleteCompletedTasks: () => number;
    addSubtask: (taskId: string, name: string) => boolean;
    deleteSubtask: (taskId: string, subtaskId: string) => void;
    toggleSubtaskComplete: (taskId: string, subtaskId: string) => void;
    setHasHydrated: (value: boolean) => void;
}

export const useMobileTaskStore = create<MobileTaskStore>()(
    persist(
        (set, get) => {
            /**
             * 完了したタスクが繰り返しなら次回分を追加する。
             * 同内容の未完了分が既にある場合と上限到達時は生成しない（Webと同一ルール）。
             */
            const spawnRecurringNext = (task: Task): void => {
                // クラウド同期中は complete_task EF がサーバー側で次回分を生成する。
                // ローカルでも生成すると別IDの重複タスクが二重にできるためスキップする。
                if (isCloudOutboxActive()) return;
                const next = buildNextRecurringTask({
                    task,
                    taskId: createMobileId(),
                    subtaskIdFor: createMobileId,
                    now: new Date().toISOString(),
                    today: getTodayJst(),
                });
                if (!next) return;
                const { tasks } = get();
                if (hasOpenRecurringDuplicate(tasks, next) || tasks.length >= TASK_LIMITS.maxTasks) return;
                set((state) => ({ tasks: [...state.tasks, next] }));
            };

            /** 待機中の完了を確定する: 報酬付与・繰り返し生成・complete_task送信 */
            const confirmCompletion = (pending: MobilePendingCompletion): void => {
                const task = get().tasks.find((candidate) => candidate.id === pending.taskId);
                set((state) => ({
                    pendingCompletions: state.pendingCompletions.filter((candidate) => candidate.taskId !== pending.taskId),
                }));
                if (!task || !task.completed) return; // 取消・削除済みなら何もしない
                const granted = useMobileGameStore.getState().grantTaskCompletionReward(task.id, task.priority);
                // 台帳が既付与でgrantedがfalseの場合は統計ログも記録しない（reconcileRewards再実行時の二重加算防止）
                if (granted) {
                    useMobileStatsStore.getState().logTaskXp(
                        toIsoDatePart(pending.completedAt),
                        XP_CONFIG.REWARD_BY_PRIORITY[task.priority],
                    );
                }
                spawnRecurringNext(task);
                void enqueueCloudOperation('complete_task', { taskId: task.id }, { dependsOnEntityIds: [task.id] });
            };

            /** 対象タスクのUndo待機をタイマーごと破棄する（確定処理は行わない） */
            const discardPending = (taskId: string): MobilePendingCompletion | undefined => {
                const pending = get().pendingCompletions.find((candidate) => candidate.taskId === taskId);
                if (!pending) return undefined;
                clearTimeout(pending.timeoutId);
                set((state) => ({
                    pendingCompletions: state.pendingCompletions.filter((candidate) => candidate.taskId !== taskId),
                }));
                return pending;
            };

            return {
                tasks: [],
                hasHydrated: false,
                pendingCompletions: [],

                addTask: (name, priority = 'medium', options = {}) => {
                    if (!get().hasHydrated || get().tasks.length >= TASK_LIMITS.maxTasks) return false;
                    const task = createTask({
                        id: createMobileId(),
                        name,
                        priority,
                        dueDate: options.dueDate ?? null,
                        tags: options.tags ?? [],
                        recurrence: options.recurrence ?? 'none',
                        now: new Date().toISOString(),
                    });
                    if (!task) return false;
                    set((state) => ({ tasks: [...state.tasks, task] }));
                    // ログイン中はクラウドへも書き込む（オフラインならoutboxが再送する）。
                    // Web仕様と同じ情報量（priority / dueDate / tags / recurrence）を送る。
                    void enqueueCloudOperation('upsert_task', {
                        p_id: task.id,
                        p_name: task.name,
                        p_due_date: task.dueDate,
                        p_priority: task.priority,
                        p_recurrence: task.recurrence,
                        p_tags: task.tags,
                    }, { trackEntityId: task.id });
                    return true;
                },

                toggleTask: (taskId) => {
                    if (!get().hasHydrated) return;
                    const before = get().tasks.find((task) => task.id === taskId);
                    if (!before) return;

                    if (before.completed) {
                        // 完了→未完了。Undo待機中ならタイマーを止めるだけでよい
                        //（報酬もRPCもまだ発生していない = 取り消すものがない）。
                        const wasPending = discardPending(taskId) !== undefined;
                        set((state) => ({
                            tasks: toggleTaskCompletion(state.tasks, taskId, new Date().toISOString()),
                        }));
                        if (!wasPending) {
                            void enqueueCloudOperation('uncomplete_task', { p_id: taskId }, { dependsOnEntityIds: [taskId] });
                        }
                        return;
                    }

                    // 未完了→完了: 表示は即時に完了へ切り替え、報酬付与・繰り返し生成・
                    // complete_task送信は5秒のUndo猶予後に確定する（Web toggleCompleteと同一設計）。
                    if (get().pendingCompletions.some((pending) => pending.taskId === taskId)) return; // 既に待機中
                    const completedAt = new Date().toISOString();
                    set((state) => ({
                        tasks: toggleTaskCompletion(state.tasks, taskId, completedAt),
                    }));
                    const timeoutId = setTimeout(() => {
                        const pending = get().pendingCompletions.find((candidate) =>
                            candidate.taskId === taskId && candidate.completedAt === completedAt);
                        if (pending) confirmCompletion(pending);
                    }, TASK_UNDO_DURATION_MS);
                    set((state) => ({
                        pendingCompletions: [...state.pendingCompletions, { taskId, timeoutId, completedAt }],
                    }));
                },

                cancelPendingCompletion: (taskId) => {
                    const pending = discardPending(taskId);
                    if (!pending) return false;
                    set((state) => ({
                        tasks: state.tasks.map((task) => task.id === taskId
                            ? { ...task, completed: false, completedAt: null }
                            : task),
                    }));
                    return true;
                },

                flushPendingCompletions: () => {
                    for (const pending of [...get().pendingCompletions]) {
                        clearTimeout(pending.timeoutId);
                        confirmCompletion(pending);
                    }
                },

                updateTask: (taskId, updates) => {
                    if (!get().hasHydrated) return;
                    const now = new Date().toISOString();
                    // 5秒Undoタイマーとの競合を防ぐため、保留中の完了をキャンセル（Webと同一）
                    const hadPending = updates.subtasks !== undefined && discardPending(taskId) !== undefined;
                    set((state) => ({
                        tasks: updateTaskFields(state.tasks, taskId, updates, { now, hadPendingCompletion: hadPending }),
                    }));
                    const updated = get().tasks.find((task) => task.id === taskId);
                    if (!updated) return;
                    void enqueueCloudOperation('upsert_task', {
                        p_id: updated.id,
                        p_name: updated.name,
                        p_due_date: updated.dueDate,
                        p_priority: updated.priority,
                        p_recurrence: updated.recurrence,
                        p_tags: updated.tags,
                    }, { dependsOnEntityIds: [taskId] });
                },

                duplicateTask: (taskId) => {
                    if (!get().hasHydrated) return null;
                    const duplicate = duplicateTaskCore({
                        tasks: get().tasks,
                        sourceId: taskId,
                        newId: createMobileId(),
                        subtaskIdFor: createMobileId,
                        now: new Date().toISOString(),
                        today: getTodayJst(),
                    });
                    if (!duplicate) return null;
                    set((state) => ({ tasks: [...state.tasks, duplicate] }));
                    void enqueueCloudOperation('upsert_task', {
                        p_id: duplicate.id,
                        p_name: duplicate.name,
                        p_due_date: duplicate.dueDate,
                        p_priority: duplicate.priority,
                        p_recurrence: duplicate.recurrence,
                        p_tags: duplicate.tags,
                    }, { trackEntityId: duplicate.id });
                    for (const subtask of duplicate.subtasks) {
                        void enqueueCloudOperation(
                            'upsert_subtask',
                            { p_id: subtask.id, p_task_id: duplicate.id, p_name: subtask.name },
                            { dependsOnEntityIds: [duplicate.id], trackEntityId: subtask.id },
                        );
                    }
                    return duplicate.id;
                },

                deleteCompletedTasks: () => {
                    if (!get().hasHydrated) return 0;
                    const { tasks, pendingCompletions } = get();
                    // 保留中（5秒Undo待ち）のタスクは削除対象から除外する（Webと同一）
                    const pendingIds = new Set(pendingCompletions.map((pending) => pending.taskId));
                    const remaining = removeCompletedTasks(tasks, pendingIds);
                    const removedIds = tasks
                        .filter((task) => !remaining.includes(task))
                        .map((task) => task.id);
                    if (removedIds.length === 0) return 0;
                    set({ tasks: remaining });
                    for (const removedId of removedIds) {
                        void enqueueCloudOperation('delete_task', { p_id: removedId }, { dependsOnEntityIds: [removedId] });
                    }
                    return removedIds.length;
                },

                deleteTask: (taskId) => {
                    if (!get().hasHydrated) return;
                    discardPending(taskId); // Undo待機中でも削除は即時（確定処理は走らせない）
                    set((state) => ({ tasks: removeTask(state.tasks, taskId) }));
                    // 作成がまだ未送信ならその後に削除が送られる（dependsOnで順序保証）
                    void enqueueCloudOperation('delete_task', { p_id: taskId }, { dependsOnEntityIds: [taskId] });
                },

                addSubtask: (taskId, name) => {
                    if (!get().hasHydrated) return false;
                    const next = addSubtaskToTask(get().tasks, taskId, {
                        id: createMobileId(),
                        name,
                        now: new Date().toISOString(),
                    });
                    if (!next) return false;
                    set({ tasks: next });
                    const added = next.find((candidate) => candidate.id === taskId)?.subtasks.at(-1);
                    if (added) {
                        // 親タスクの作成が未送信でも、dependsOnにより必ず親→子の順で送られる
                        void enqueueCloudOperation(
                            'upsert_subtask',
                            { p_id: added.id, p_task_id: taskId, p_name: added.name },
                            { dependsOnEntityIds: [taskId], trackEntityId: added.id },
                        );
                    }
                    return true;
                },

                deleteSubtask: (taskId, subtaskId) => {
                    if (!get().hasHydrated) return;
                    const task = get().tasks.find((candidate) => candidate.id === taskId);
                    const now = new Date().toISOString();
                    const result = removeSubtaskFromTask(get().tasks, taskId, subtaskId, now);
                    if (!result || !task) return;
                    set({ tasks: result.tasks });
                    void enqueueCloudOperation('delete_subtask', { p_id: subtaskId }, { dependsOnEntityIds: [subtaskId] });
                    // 残りのサブタスク全完了で親が完了した場合はタスク報酬と繰り返し生成
                    if (result.parentCompleted) {
                        const granted = useMobileGameStore.getState().grantTaskCompletionReward(taskId, task.priority);
                        if (granted) {
                            useMobileStatsStore.getState().logTaskXp(
                                toIsoDatePart(now),
                                XP_CONFIG.REWARD_BY_PRIORITY[task.priority],
                            );
                        }
                        spawnRecurringNext(task);
                        // サーバーのdelete_subtaskは親完了まで連鎖しないため、明示的に完了を送る
                        //（報酬の重複はサーバーのreward_transactionsが防ぐ）
                        void enqueueCloudOperation('complete_task', { taskId }, { dependsOnEntityIds: [taskId, subtaskId] });
                    }
                },

                toggleSubtaskComplete: (taskId, subtaskId) => {
                    if (!get().hasHydrated) return;
                    const task = get().tasks.find((candidate) => candidate.id === taskId);
                    const now = new Date().toISOString();
                    const result = toggleSubtask(get().tasks, taskId, subtaskId, now);
                    if (!result || !task) return;
                    set({ tasks: result.tasks });

                    const game = useMobileGameStore.getState();
                    if (result.completedSubtask) {
                        const granted = game.grantSubtaskCompletionReward(subtaskId, task.priority);
                        if (granted) {
                            useMobileStatsStore.getState().logTaskXp(toIsoDatePart(now), getSubtaskRewardXp(task.priority));
                        }
                        // サーバー側は complete_subtask が親完了・親報酬まで連鎖する（#502）
                        void enqueueCloudOperation('complete_subtask', { subtaskId }, { dependsOnEntityIds: [subtaskId, taskId] });
                    } else {
                        void enqueueCloudOperation('uncomplete_subtask', { p_id: subtaskId }, { dependsOnEntityIds: [subtaskId] });
                    }
                    if (result.parentCompleted) {
                        const granted = game.grantTaskCompletionReward(taskId, task.priority);
                        if (granted) {
                            useMobileStatsStore.getState().logTaskXp(
                                toIsoDatePart(now),
                                XP_CONFIG.REWARD_BY_PRIORITY[task.priority],
                            );
                        }
                        spawnRecurringNext(task);
                    }
                },

                setHasHydrated: (hasHydrated) => set({ hasHydrated }),
            };
        },
        {
            name: 'quest-board-tasks',
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state) => ({ tasks: state.tasks }),
            merge: (persisted, current) => {
                const persistedTasks = typeof persisted === 'object' && persisted !== null && 'tasks' in persisted
                    ? (persisted as { tasks?: unknown }).tasks
                    : undefined;
                return { ...current, tasks: sanitizeTaskCollection(persistedTasks) };
            },
            onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
        }
    )
);
