import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 習慣一覧の並び順 */
export type HabitSortMode = 'createdAt' | 'name' | 'streak' | 'completionRate';

const VALID_HABIT_SORT_MODES: readonly HabitSortMode[] = ['createdAt', 'name', 'streak', 'completionRate'];

export function sanitizeHabitSortMode(value: unknown): HabitSortMode {
    return VALID_HABIT_SORT_MODES.includes(value as HabitSortMode) ? (value as HabitSortMode) : 'createdAt';
}

interface HabitSortStoreState {
    sortMode: HabitSortMode;
    setSortMode: (mode: HabitSortMode) => void;
}

export const useHabitSortStore = create<HabitSortStoreState>()(
    persist(
        (set) => ({
            sortMode: 'createdAt',
            setSortMode: (mode: HabitSortMode) => set({ sortMode: sanitizeHabitSortMode(mode) }),
        }),
        {
            name: 'quest-board-habit-sort',
            version: 1,
            merge: (persisted, current) => {
                const incoming = (persisted as Partial<HabitSortStoreState> | undefined)?.sortMode;
                return { ...current, sortMode: sanitizeHabitSortMode(incoming) };
            },
        }
    )
);
