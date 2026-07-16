import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createWebPersistStorage } from '../platform/storage';
import type { StatsStoreState } from '../types';
import {
    appendHabitActivity,
    appendTaskXp,
    mergeHabitLogs,
    mergeTaskXpLogs,
    sanitizeHabitLog,
    sanitizeTaskXpLog,
} from '../core/statsLog';

export { MAX_STATS_DAILY_VALUE, MAX_STATS_LOG_ENTRIES } from '../core/statsLog';

type StatsStorePersisted = Pick<StatsStoreState, 'taskXpLog' | 'habitLog'>;

export function sanitizeStatsStoreState(persisted: unknown): StatsStorePersisted {
    const raw = (typeof persisted === 'object' && persisted !== null
        ? (persisted as Record<string, unknown>)
        : {});

    return {
        taskXpLog: sanitizeTaskXpLog(raw.taskXpLog),
        habitLog: sanitizeHabitLog(raw.habitLog),
    };
}

export const useStatsStore = create<StatsStoreState>()(
    persist(
        (set) => ({
            taskXpLog: {},
            habitLog: {},

            logTaskXp: (date: string, xp: number) => {
                set((state) => ({ taskXpLog: appendTaskXp(state.taskXpLog, date, xp) }));
            },

            logHabitActivity: (date: string, count: number, allComplete: boolean) => {
                set((state) => ({ habitLog: appendHabitActivity(state.habitLog, date, count, allComplete) }));
            },

            mergeFromCloud: (snapshot) => {
                set((state) => ({
                    taskXpLog: mergeTaskXpLogs(state.taskXpLog, snapshot.taskXpLog),
                    habitLog: mergeHabitLogs(state.habitLog, snapshot.habitLog),
                }));
            },
        }),
        {
            name: 'quest-board-stats',
            storage: createWebPersistStorage(),
            version: 1,
            merge: (persisted, current) => ({
                ...current,
                ...sanitizeStatsStoreState(persisted),
            }),
        }
    )
);
