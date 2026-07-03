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
                    return true;
                },

                toggleTask: (taskId) => {
                    if (!get().hasHydrated) return;
                    const before = get().tasks.find((task) => task.id === taskId);
                    set((state) => ({
                        tasks: toggleTaskCompletion(state.tasks, taskId, new Date().toISOString()),
                    }));
                    // 未完了→完了への遷移でのみ報酬を付与する。
                    // 二重付与防止はゲームストア側の報酬台帳が保証する。
                    if (before && !before.completed) {
                        useMobileGameStore.getState().grantTaskCompletionReward(taskId, before.priority);
                        spawnRecurringNext(before);
                    }
                },

                deleteTask: (taskId) => {
                    if (!get().hasHydrated) return;
                    set((state) => ({ tasks: removeTask(state.tasks, taskId) }));
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
                    return true;
                },

                deleteSubtask: (taskId, subtaskId) => {
                    if (!get().hasHydrated) return;
                    const task = get().tasks.find((candidate) => candidate.id === taskId);
                    const result = removeSubtaskFromTask(get().tasks, taskId, subtaskId, new Date().toISOString());
                    if (!result || !task) return;
                    set({ tasks: result.tasks });
                    // 残りのサブタスク全完了で親が完了した場合はタスク報酬と繰り返し生成
                    if (result.parentCompleted) {
                        useMobileGameStore.getState().grantTaskCompletionReward(taskId, task.priority);
                        spawnRecurringNext(task);
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
