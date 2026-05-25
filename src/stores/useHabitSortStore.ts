import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 習慣一覧の並び順 */
export type HabitSortMode = 'createdAt' | 'name' | 'streak' | 'completionRate';

interface HabitSortStoreState {
    sortMode: HabitSortMode;
    setSortMode: (mode: HabitSortMode) => void;
}

export const useHabitSortStore = create<HabitSortStoreState>()(
    persist(
        (set) => ({
            sortMode: 'createdAt',
            setSortMode: (mode: HabitSortMode) => set({ sortMode: mode }),
        }),
        {
            name: 'quest-board-habit-sort',
        }
    )
);
