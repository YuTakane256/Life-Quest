import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Task, PendingCompletion, Priority, TaskStoreState } from '../types';
import { XP_CONFIG, UI_CONFIG } from '../config/gameConfig';
import { generateId } from '../utils/dateUtils';

/** pending completions はLocalStorageに保存しない（タイマーは復元不可能） */
interface TaskStorePersisted {
    tasks: Task[];
}

// gameStoreを遅延importして循環参照を避ける
const getGameStore = () => import('./useGameStore').then(m => m.useGameStore);
const getStatsStore = () => import('./useStatsStore').then(m => m.useStatsStore);

export const useTaskStore = create<TaskStoreState>()(
    persist(
        (set, get) => ({
            tasks: [],
            pendingCompletions: [],

            addTask: (name: string, dueDate: string | null, priority: Priority, tags: string[] = []) => {
                const newTask: Task = {
                    id: generateId(),
                    name,
                    dueDate,
                    priority,
                    tags,
                    completed: false,
                    completedAt: null,
                    createdAt: new Date().toISOString(),
                };
                set((state) => ({ tasks: [...state.tasks, newTask] }));
            },

            updateTask: (id: string, updates: Partial<Pick<Task, 'name' | 'dueDate' | 'priority' | 'tags'>>) => {
                set((state) => ({
                    tasks: state.tasks.map((t) =>
                        t.id === id ? { ...t, ...updates } : t
                    ),
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

                    // 報酬付与
                    const xpReward = XP_CONFIG.REWARD_BY_PRIORITY[pendingTask.priority];
                    const gameStore = await getGameStore();
                    const store = gameStore.getState();
                    store.addXp(xpReward);
                    store.incrementGachaCount();
                    store.checkGachaMilestones();

                    // 統計ログ記録
                    const dateStr = completedAt.split('T')[0];
                    const statsStore = await getStatsStore();
                    statsStore.getState().logTaskXp(dateStr, xpReward);
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
