import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    createTask,
    removeTask,
    sanitizeTaskCollection,
    TASK_LIMITS,
    toggleTaskCompletion,
    type Task,
} from '@life-quest/core/tasks';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createMobileId } from '../utils/createMobileId';
import { useMobileGameStore } from './useMobileGameStore';

interface MobileTaskStore {
    tasks: Task[];
    hasHydrated: boolean;
    addTask: (name: string) => boolean;
    toggleTask: (taskId: string) => void;
    deleteTask: (taskId: string) => void;
    setHasHydrated: (value: boolean) => void;
}

export const useMobileTaskStore = create<MobileTaskStore>()(
    persist(
        (set, get) => ({
            tasks: [],
            hasHydrated: false,
            addTask: (name) => {
                if (get().tasks.length >= TASK_LIMITS.maxTasks) return false;
                const task = createTask({ id: createMobileId(), name, now: new Date().toISOString() });
                if (!task) return false;
                set((state) => ({ tasks: [...state.tasks, task] }));
                return true;
            },
            toggleTask: (taskId) => {
                const before = get().tasks.find((task) => task.id === taskId);
                set((state) => ({
                    tasks: toggleTaskCompletion(state.tasks, taskId, new Date().toISOString()),
                }));
                // 未完了→完了への遷移でのみ報酬を付与する。
                // 二重付与防止はゲームストア側の報酬台帳が保証する。
                if (before && !before.completed) {
                    useMobileGameStore.getState().grantTaskCompletionReward(taskId, before.priority);
                }
            },
            deleteTask: (taskId) => set((state) => ({ tasks: removeTask(state.tasks, taskId) })),
            setHasHydrated: (hasHydrated) => set({ hasHydrated }),
        }),
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
