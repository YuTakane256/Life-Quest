import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** タスク一覧の並び順 */
export type TaskSortMode = 'dueDate' | 'priority' | 'createdAt';

const VALID_TASK_SORT_MODES: readonly TaskSortMode[] = ['dueDate', 'priority', 'createdAt'];

function sanitizeTaskSortMode(value: unknown): TaskSortMode {
    return VALID_TASK_SORT_MODES.includes(value as TaskSortMode) ? (value as TaskSortMode) : 'dueDate';
}

interface TaskSortStoreState {
    sortMode: TaskSortMode;
    setSortMode: (mode: TaskSortMode) => void;
}

export const useTaskSortStore = create<TaskSortStoreState>()(
    persist(
        (set) => ({
            sortMode: 'dueDate',
            setSortMode: (mode: TaskSortMode) => set({ sortMode: sanitizeTaskSortMode(mode) }),
        }),
        {
            name: 'quest-board-task-sort',
            version: 1,
            merge: (persisted, current) => {
                const incoming = (persisted as Partial<TaskSortStoreState> | undefined)?.sortMode;
                return { ...current, sortMode: sanitizeTaskSortMode(incoming) };
            },
        }
    )
);
