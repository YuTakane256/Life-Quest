import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** タスク一覧の並び順 */
export type TaskSortMode = 'dueDate' | 'priority' | 'createdAt';

interface TaskSortStoreState {
    sortMode: TaskSortMode;
    setSortMode: (mode: TaskSortMode) => void;
}

export const useTaskSortStore = create<TaskSortStoreState>()(
    persist(
        (set) => ({
            sortMode: 'dueDate',
            setSortMode: (mode: TaskSortMode) => set({ sortMode: mode }),
        }),
        {
            name: 'quest-board-task-sort',
        }
    )
);
