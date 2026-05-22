import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Task, Subtask, PendingCompletion, Priority, Recurrence, TaskStoreState } from '../types';
import { XP_CONFIG, UI_CONFIG } from '../config/gameConfig';
import { generateId, getTodayJST, addRecurrenceInterval } from '../utils/dateUtils';

/** pending completions はLocalStorageに保存しない（タイマーは復元不可能） */
interface TaskStorePersisted {
    tasks: Task[];
}

// gameStoreを遅延importして循環参照を避ける
const getGameStore = () => import('./useGameStore').then(m => m.useGameStore);
const getStatsStore = () => import('./useStatsStore').then(m => m.useStatsStore);

async function awardTaskXp(priority: Priority, completedAt: string, xpReward: number = XP_CONFIG.REWARD_BY_PRIORITY[priority]) {
    const gameStore = await getGameStore();
    const store = gameStore.getState();
    store.addXp(xpReward);
    store.incrementGachaCount();
    store.checkGachaMilestones();

    const dateStr = completedAt.split('T')[0];
    const statsStore = await getStatsStore();
    statsStore.getState().logTaskXp(dateStr, xpReward);
}

function getSubtaskXp(priority: Priority) {
    return Math.max(1, Math.floor(XP_CONFIG.REWARD_BY_PRIORITY[priority] * XP_CONFIG.SUBTASK_REWARD_RATIO));
}

/**
 * 繰り返しタスクの次回分を生成する。recurrence が none なら null。
 * 期限は元タスクの期限（無ければ今日）を1周期分進める。サブタスクは未完了状態で引き継ぐ。
 */
function buildNextRecurringTask(task: Task): Task | null {
    if (!task.recurrence || task.recurrence === 'none') return null;
    const base = task.dueDate ?? getTodayJST();
    const now = new Date().toISOString();
    return {
        id: generateId(),
        name: task.name,
        dueDate: addRecurrenceInterval(base, task.recurrence),
        priority: task.priority,
        tags: [...(task.tags || [])],
        subtasks: (task.subtasks || []).map((s) => ({
            id: generateId(),
            name: s.name,
            completed: false,
            completedAt: null,
            createdAt: now,
        })),
        recurrence: task.recurrence,
        completed: false,
        completedAt: null,
        createdAt: now,
    };
}

export const useTaskStore = create<TaskStoreState>()(
    persist(
        (set, get) => ({
            tasks: [],
            pendingCompletions: [],

            addTask: (name: string, dueDate: string | null, priority: Priority, recurrence: Recurrence = 'none', tags: string[] = [], subtasks: Subtask[] = []) => {
                const newTask: Task = {
                    id: generateId(),
                    name,
                    dueDate,
                    priority,
                    tags,
                    subtasks,
                    recurrence,
                    completed: false,
                    completedAt: null,
                    createdAt: new Date().toISOString(),
                };
                set((state) => ({ tasks: [...state.tasks, newTask] }));
            },

            updateTask: (id: string, updates: Partial<Pick<Task, 'name' | 'dueDate' | 'priority' | 'tags' | 'subtasks'>>) => {
                // サブタスクが更新対象に含まれない場合は単純マージ
                if (updates.subtasks === undefined) {
                    set((state) => ({
                        tasks: state.tasks.map((t) =>
                            t.id === id ? { ...t, ...updates } : t
                        ),
                    }));
                    return;
                }

                // サブタスク更新時は親タスクの完了状態を再計算する
                const nextSubtasks = updates.subtasks;
                const now = new Date().toISOString();
                const allComplete = nextSubtasks.length > 0 && nextSubtasks.every((s) => s.completed);

                // 5秒Undoタイマーとの競合を防ぐため、保留中の完了をキャンセル
                if (nextSubtasks.length > 0) {
                    const pending = get().pendingCompletions.find((p) => p.taskId === id);
                    if (pending) {
                        window.clearTimeout(pending.timeoutId);
                    }
                }

                set((state) => ({
                    tasks: state.tasks.map((t) => {
                        if (t.id !== id) return t;
                        let completed = t.completed;
                        let completedAt = t.completedAt;
                        if (nextSubtasks.length > 0) {
                            completed = allComplete;
                            completedAt = allComplete ? (t.completedAt || now) : null;
                        }
                        return { ...t, ...updates, completed, completedAt };
                    }),
                    pendingCompletions: nextSubtasks.length > 0
                        ? state.pendingCompletions.filter((p) => p.taskId !== id)
                        : state.pendingCompletions,
                }));
            },

            deleteTask: (id: string) => {
                // pending completionがあればキャンセル
                const pending = get().pendingCompletions.find((p) => p.taskId === id);
                if (pending) {
                    window.clearTimeout(pending.timeoutId);
                }
                set((state) => ({
                    tasks: state.tasks.filter((t) => t.id !== id),
                    pendingCompletions: state.pendingCompletions.filter((p) => p.taskId !== id),
                }));
            },

            toggleComplete: (id: string) => {
                const task = get().tasks.find((t) => t.id === id);
                if (!task) return;

                if (task.completed) {
                    // 完了を取り消す場合（既に報酬付与済みなので差し戻さない）
                    set((state) => ({
                        tasks: state.tasks.map((t) =>
                            t.id === id ? { ...t, completed: false, completedAt: null } : t
                        ),
                    }));
                    return;
                }

                // 未完了 → 完了: 5秒待機キューに入れる
                const existingPending = get().pendingCompletions.find((p) => p.taskId === id);
                if (existingPending) return; // 既に待機中

                const completedAt = new Date().toISOString();

                const timeoutId = window.setTimeout(async () => {
                    // 5秒後に確定処理
                    const currentState = get();
                    const pendingTask = currentState.tasks.find((t) => t.id === id);
                    if (!pendingTask) return;

                    // タスクを完了状態にする
                    set((state) => ({
                        tasks: state.tasks.map((t) =>
                            t.id === id ? { ...t, completed: true, completedAt } : t
                        ),
                        pendingCompletions: state.pendingCompletions.filter((p) => p.taskId !== id),
                    }));

                    await awardTaskXp(pendingTask.priority, completedAt);

                    // 繰り返しタスクなら次回分を自動生成する
                    const next = buildNextRecurringTask(pendingTask);
                    if (next) {
                        const exists = get().tasks.some(
                            (t) => !t.completed && t.recurrence === next.recurrence && t.name === next.name && t.dueDate === next.dueDate
                        );
                        if (!exists) {
                            set((state) => ({ tasks: [...state.tasks, next] }));
                        }
                    }
                }, UI_CONFIG.UNDO_DURATION_MS);

                const pendingCompletion: PendingCompletion = {
                    taskId: id,
                    timeoutId,
                    completedAt,
                };

                set((state) => ({
                    tasks: state.tasks.map((t) =>
                        t.id === id ? { ...t, completed: true, completedAt } : t
                    ),
                    pendingCompletions: [...state.pendingCompletions, pendingCompletion],
                }));
            },

            addSubtask: (taskId: string, name: string) => {
                const trimmedName = name.trim();
                if (!trimmedName) return;

                set((state) => ({
                    tasks: state.tasks.map((task) =>
                        task.id === taskId
                            ? {
                                ...task,
                                completed: false,
                                completedAt: null,
                                subtasks: [
                                    ...(task.subtasks || []),
                                    {
                                        id: generateId(),
                                        name: trimmedName,
                                        completed: false,
                                        completedAt: null,
                                        createdAt: new Date().toISOString(),
                                    },
                                ],
                            }
                            : task
                    ),
                }));
            },

            deleteSubtask: (taskId: string, subtaskId: string) => {
                const task = get().tasks.find((t) => t.id === taskId);
                if (!task) return;

                const nextSubtasks = (task.subtasks || []).filter((subtask) => subtask.id !== subtaskId);
                const completedAt = new Date().toISOString();
                const shouldAutoComplete = nextSubtasks.length > 0 && nextSubtasks.every((subtask) => subtask.completed);

                set((state) => ({
                    tasks: state.tasks.map((t) =>
                        t.id === taskId
                            ? {
                                ...t,
                                subtasks: nextSubtasks,
                                completed: shouldAutoComplete ? true : t.completed && nextSubtasks.length === 0,
                                completedAt: shouldAutoComplete ? (t.completedAt || completedAt) : t.completedAt,
                            }
                            : t
                    ),
                }));
            },

            toggleSubtaskComplete: (taskId: string, subtaskId: string) => {
                const task = get().tasks.find((t) => t.id === taskId);
                if (!task) return;

                const subtask = (task.subtasks || []).find((s) => s.id === subtaskId);
                if (!subtask) return;

                const isCompleting = !subtask.completed;
                const completedAt = new Date().toISOString();
                const nextSubtasks = (task.subtasks || []).map((s) =>
                    s.id === subtaskId
                        ? { ...s, completed: isCompleting, completedAt: isCompleting ? completedAt : null }
                        : s
                );
                const allSubtasksComplete = nextSubtasks.length > 0 && nextSubtasks.every((s) => s.completed);
                const pending = get().pendingCompletions.find((p) => p.taskId === taskId);
                if (pending) {
                    window.clearTimeout(pending.timeoutId);
                }

                set((state) => ({
                    tasks: state.tasks.map((t) =>
                        t.id === taskId
                            ? {
                                ...t,
                                subtasks: nextSubtasks,
                                completed: allSubtasksComplete,
                                completedAt: allSubtasksComplete ? (t.completedAt || completedAt) : null,
                            }
                            : t
                    ),
                    pendingCompletions: state.pendingCompletions.filter((p) => p.taskId !== taskId),
                }));

                if (isCompleting) {
                    void awardTaskXp(task.priority, completedAt, getSubtaskXp(task.priority));
                }

                // サブタスク完了で親タスクが完了したら、繰り返しタスクの次回分を生成
                if (isCompleting && allSubtasksComplete && !task.completed) {
                    const next = buildNextRecurringTask(task);
                    if (next) {
                        const exists = get().tasks.some(
                            (t) => !t.completed && t.recurrence === next.recurrence && t.name === next.name && t.dueDate === next.dueDate
                        );
                        if (!exists) {
                            set((state) => ({ tasks: [...state.tasks, next] }));
                        }
                    }
                }
            },

            cancelPendingCompletion: (taskId: string) => {
                const pending = get().pendingCompletions.find((p) => p.taskId === taskId);
                if (!pending) return;

                window.clearTimeout(pending.timeoutId);

                set((state) => ({
                    tasks: state.tasks.map((t) =>
                        t.id === taskId ? { ...t, completed: false, completedAt: null } : t
                    ),
                    pendingCompletions: state.pendingCompletions.filter((p) => p.taskId !== taskId),
                }));
            },
        }),
        {
            name: 'quest-board-tasks',
            partialize: (state): TaskStorePersisted => ({
                tasks: state.tasks,
            }),
        }
    )
);
