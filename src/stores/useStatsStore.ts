import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StatsStoreState } from '../types';

export const useStatsStore = create<StatsStoreState>()(
    persist(
        (set) => ({
            taskXpLog: {},
            habitLog: {},

            logTaskXp: (date: string, xp: number) => {
                set((state) => ({
                    taskXpLog: {
                        ...state.taskXpLog,
                        [date]: (state.taskXpLog[date] || 0) + xp,
                    },
                }));
            },

            logHabitActivity: (date: string, count: number, allComplete: boolean) => {
                set((state) => ({
                    habitLog: {
                        ...state.habitLog,
                        [date]: { count, allComplete },
                    },
                }));
            },
        }),
        {
            name: 'quest-board-stats',
        }
    )
);
