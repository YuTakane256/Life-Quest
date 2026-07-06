import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    addSubtaskToTask,
    buildNextRecurringTask,
    createTask,
    hasOpenRecurringDuplicate,
    removeSubtaskFromTask,
    removeTask,
    sanitizeTaskCollection,
    TASK_LIMITS,
    toggleSubtask,
    toggleTaskCompletion,
    type Priority,
    type Recurrence,
    type Task,
} from '@life-quest/core/tasks';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createMobileId } from '../utils/createMobileId';
import { getTodayJst } from '../utils/date';
import { useMobileGameStore } from './useMobileGameStore';
import { enqueueCloudOperation, isCloudOutboxActive } from '../platform/cloudOutbox';

export interface AddTaskOptions {
    dueDate?: string | null;
    tags?: string[];
    recurrence?: Recurrence;
}

interface MobileTaskStore {
    tasks: Task[];
    hasHydrated: boolean;
    addTask: (name: string, priority?: Priority, options?: AddTaskOptions) => boolean;
    toggleTask: (taskId: string) => void;
    deleteTask: (taskId: string) => void;
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

            return {
                tasks: [],
                hasHydrated: false,

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
                    set((state) => ({
                        tasks: toggleTaskCompletion(state.tasks, taskId, new Date().toISOString()),
                    }));
                    // 未完了→完了への遷移でのみ報酬を付与する。
                    // ローカル付与は楽観表示で、正はサーバー（complete_task EF、ADR-003）。
                    // 二重付与防止はローカルは報酬台帳、サーバーはreward_transactionsが保証する。
                    if (before && !before.completed) {
                        useMobileGameStore.getState().grantTaskCompletionReward(taskId, before.priority);
                        spawnRecurringNext(before);
                        void enqueueCloudOperation('complete_task', { taskId }, { dependsOnEntityIds: [taskId] });
                    } else if (before && before.completed) {
                        void enqueueCloudOperation('uncomplete_task', { p_id: taskId }, { dependsOnEntityIds: [taskId] });
                    }
                },

                deleteTask: (taskId) => {
                    if (!get().hasHydrated) return;
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
                    const result = removeSubtaskFromTask(get().tasks, taskId, subtaskId, new Date().toISOString());
                    if (!result || !task) return;
                    set({ tasks: result.tasks });
                    void enqueueCloudOperation('delete_subtask', { p_id: subtaskId }, { dependsOnEntityIds: [subtaskId] });
                    // 残りのサブタスク全完了で親が完了した場合はタスク報酬と繰り返し生成
                    if (result.parentCompleted) {
                        useMobileGameStore.getState().grantTaskCompletionReward(taskId, task.priority);
                        spawnRecurringNext(task);
                        // サーバーのdelete_subtaskは親完了まで連鎖しないため、明示的に完了を送る
                        //（報酬の重複はサーバーのreward_transactionsが防ぐ）
                        void enqueueCloudOperation('complete_task', { taskId }, { dependsOnEntityIds: [taskId, subtaskId] });
                    }
                },

                toggleSubtaskComplete: (taskId, subtaskId) => {
                    if (!get().hasHydrated) return;
                    const task = get().tasks.find((candidate) => candidate.id === taskId);
                    const result = toggleSubtask(get().tasks, taskId, subtaskId, new Date().toISOString());
                    if (!result || !task) return;
                    set({ tasks: result.tasks });

                    const game = useMobileGameStore.getState();
                    if (result.completedSubtask) {
                        game.grantSubtaskCompletionReward(subtaskId, task.priority);
                        // サーバー側は complete_subtask が親完了・親報酬まで連鎖する（#502）
                        void enqueueCloudOperation('complete_subtask', { subtaskId }, { dependsOnEntityIds: [subtaskId, taskId] });
                    } else {
                        void enqueueCloudOperation('uncomplete_subtask', { p_id: subtaskId }, { dependsOnEntityIds: [subtaskId] });
                    }
                    if (result.parentCompleted) {
                        game.grantTaskCompletionReward(taskId, task.priority);
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
