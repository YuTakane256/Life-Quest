import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Task, Subtask, PendingCompletion, Priority, Recurrence, TaskStoreState } from '../types';
import { XP_CONFIG, UI_CONFIG } from '../config/gameConfig';
import { generateId, getTodayJST, addRecurrenceInterval } from '../utils/dateUtils';
import { clampString } from '../utils/validation';
import { isPlainObject, sanitizeTimestamp, sanitizeNullableTimestamp, sanitizeNullableYmd } from '../utils/persistSanitize';

/** pending completions はLocalStorageに保存しない（タイマーは復元不可能） */
interface TaskStorePersisted {
    tasks: Task[];
}

// gameStoreを遅延importして循環参照を避ける
const getGameStore = () => import('./useGameStore').then(m => m.useGameStore);
const getStatsStore = () => import('./useStatsStore').then(m => m.useStatsStore);

const PRIORITIES: Priority[] = ['low', 'medium', 'high'];
const RECURRENCES: Recurrence[] = ['none', 'daily', 'weekly', 'monthly'];

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

function clearPendingCompletionTimer(pending: PendingCompletion | undefined) {
    if (pending) {
        window.clearTimeout(pending.timeoutId);
    }
}

function isPriority(value: unknown): value is Priority {
    return typeof value === 'string' && PRIORITIES.includes(value as Priority);
}

function isRecurrence(value: unknown): value is Recurrence {
    return typeof value === 'string' && RECURRENCES.includes(value as Recurrence);
}

function sanitizeSubtask(raw: unknown): Subtask | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;

    return {
        id: raw.id,
        name: clampString(raw.name, UI_CONFIG.MAX_SUBTASK_NAME_LENGTH),
        completed: typeof raw.completed === 'boolean' ? raw.completed : false,
        completedAt: sanitizeNullableTimestamp(raw.completedAt),
        createdAt: sanitizeTimestamp(raw.createdAt),
    };
}

function sanitizeTask(raw: unknown): Task | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.createdAt !== 'string') return null;

    return {
        id: raw.id,
        name: clampString(raw.name, UI_CONFIG.MAX_TASK_NAME_LENGTH),
        dueDate: sanitizeNullableYmd(raw.dueDate),
        priority: isPriority(raw.priority) ? raw.priority : 'medium',
        tags: Array.isArray(raw.tags)
            ? raw.tags
                .filter((tag): tag is string => typeof tag === 'string')
                .slice(0, UI_CONFIG.MAX_TAGS_PER_TASK)
                .map((tag) => clampString(tag, UI_CONFIG.MAX_TAG_LENGTH))
            : [],
        subtasks: Array.isArray(raw.subtasks)
            ? raw.subtasks.map(sanitizeSubtask).filter((subtask): subtask is Subtask => subtask !== null)
            : [],
        recurrence: isRecurrence(raw.recurrence) ? raw.recurrence : 'none',
        completed: typeof raw.completed === 'boolean' ? raw.completed : false,
        completedAt: sanitizeNullableTimestamp(raw.completedAt),
        createdAt: sanitizeTimestamp(raw.createdAt),
    };
}

export function sanitizeTaskStoreState(persisted: unknown): TaskStorePersisted {
    if (!isPlainObject(persisted) || !Array.isArray(persisted.tasks)) {
        return { tasks: [] };
    }

    return {
        tasks: persisted.tasks.map(sanitizeTask).filter((task): task is Task => task !== null),
    };
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
                const safeName = clampString(name, UI_CONFIG.MAX_TASK_NAME_LENGTH);
                const safeTags = tags
                    .slice(0, UI_CONFIG.MAX_TAGS_PER_TASK)
                    .map((t) => clampString(t, UI_CONFIG.MAX_TAG_LENGTH));
                const safeSubtasks = subtasks.map((s) => ({
                    ...s,
                    name: clampString(s.name, UI_CONFIG.MAX_SUBTASK_NAME_LENGTH),
                }));
                const newTask: Task = {
                    id: generateId(),
                    name: safeName,
                    dueDate,
                    priority,
                    tags: safeTags,
                    subtasks: safeSubtasks,
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
                const pending = get().pendingCompletions.find((p) => p.taskId === id);
                clearPendingCompletionTimer(pending);

                set((state) => ({
                    tasks: state.tasks.map((t) => {
                        if (t.id !== id) return t;
                        let completed = t.completed;
                        let completedAt = t.completedAt;
                        if (nextSubtasks.length > 0) {
                            completed = allComplete;
                            completedAt = allComplete ? (t.completedAt || now) : null;
                        } else if (pending) {
                            completed = false;
                            completedAt = null;
                        }
                        return { ...t, ...updates, completed, completedAt };
                    }),
                    pendingCompletions: state.pendingCompletions.filter((p) => p.taskId !== id),
                }));
            },

            duplicateTask: (id: string) => {
                const source = get().tasks.find((t) => t.id === id);
                if (!source) return null;
                const now = new Date().toISOString();
                const newId = generateId();
                const duplicate: Task = {
                    id: newId,
                    name: source.name,
                    // 元タスクが期限なしならそのまま、設定済みなら今日に
                    dueDate: source.dueDate === null ? null : getTodayJST(),
                    priority: source.priority,
                    tags: [...(source.tags || [])],
                    subtasks: (source.subtasks || []).map((s) => ({
                        id: generateId(),
                        name: s.name,
                        completed: false,
                        completedAt: null,
                        createdAt: now,
                    })),
                    recurrence: source.recurrence,
                    completed: false,
                    completedAt: null,
                    createdAt: now,
                };
                set((state) => ({ tasks: [...state.tasks, duplicate] }));
                return newId;
            },

            deleteTask: (id: string) => {
                // pending completionがあればキャンセル
                const pending = get().pendingCompletions.find((p) => p.taskId === id);
                clearPendingCompletionTimer(pending);
                set((state) => ({
                    tasks: state.tasks.filter((t) => t.id !== id),
                    pendingCompletions: state.pendingCompletions.filter((p) => p.taskId !== id),
                }));
            },

            deleteCompletedTasks: () => {
                const { tasks, pendingCompletions } = get();
                // 保留中（5秒Undo待ち）のタスクは削除対象から除外する
                const pendingIds = new Set(pendingCompletions.map((p) => p.taskId));
                set({
                    tasks: tasks.filter((t) => !t.completed || pendingIds.has(t.id)),
                });
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
                const trimmedName = clampString(name.trim(), UI_CONFIG.MAX_SUBTASK_NAME_LENGTH);
                if (!trimmedName) return;

                const pending = get().pendingCompletions.find((p) => p.taskId === taskId);
                clearPendingCompletionTimer(pending);

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
                    pendingCompletions: state.pendingCompletions.filter((p) => p.taskId !== taskId),
                }));
            },

            deleteSubtask: (taskId: string, subtaskId: string) => {
                const task = get().tasks.find((t) => t.id === taskId);
                if (!task) return;

                const nextSubtasks = (task.subtasks || []).filter((subtask) => subtask.id !== subtaskId);
                if (nextSubtasks.length === (task.subtasks || []).length) return;

                const pending = get().pendingCompletions.find((p) => p.taskId === taskId);
                clearPendingCompletionTimer(pending);

                const completedAt = new Date().toISOString();
                const shouldAutoComplete = nextSubtasks.length > 0 && nextSubtasks.every((subtask) => subtask.completed);

                set((state) => ({
                    tasks: state.tasks.map((t) =>
                        t.id === taskId
                            ? {
                                ...t,
                                subtasks: nextSubtasks,
                                completed: shouldAutoComplete ? true : !pending && t.completed && nextSubtasks.length === 0,
                                completedAt: shouldAutoComplete ? (t.completedAt || completedAt) : pending ? null : t.completedAt,
                            }
                            : t
                    ),
                    pendingCompletions: state.pendingCompletions.filter((p) => p.taskId !== taskId),
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
                clearPendingCompletionTimer(pending);

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

                clearPendingCompletionTimer(pending);

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
            merge: (persisted, current) => ({
                ...current,
                ...sanitizeTaskStoreState(persisted),
                pendingCompletions: [],
            }),
        }
    )
);
