import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StatsStoreState } from '../types';
import { isValidYmd } from '../utils/dateUtils';

type StatsStorePersisted = Pick<StatsStoreState, 'taskXpLog' | 'habitLog'>;

export const MAX_STATS_LOG_ENTRIES = 3660;
export const MAX_STATS_DAILY_VALUE = Number.MAX_SAFE_INTEGER;

// ─── persisted state の per-entry バリデーション ─────────────────
// localStorage の細工された値が NaN 連鎖や型不整合を引き起こさないよう、
// rehydrate 時にマップの各エントリを型ガードで弾く。

function isValidDateKey(key: string): boolean {
    return isValidYmd(key);
}

function nonNegativeInteger(value: number): number | null {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.min(MAX_STATS_DAILY_VALUE, Math.floor(value));
}

function keepRecentEntries<T>(log: Record<string, T>): Record<string, T> {
    const entries = Object.entries(log);
    if (entries.length <= MAX_STATS_LOG_ENTRIES) return log;
    return Object.fromEntries(
        entries
            .sort(([left], [right]) => right.localeCompare(left))
            .slice(0, MAX_STATS_LOG_ENTRIES)
    );
}

function sanitizeTaskXpLog(raw: unknown): Record<string, number> {
    if (typeof raw !== 'object' || raw === null) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!isValidDateKey(k) || typeof v !== 'number') continue;
        const safeValue = nonNegativeInteger(v);
        if (safeValue !== null) out[k] = safeValue;
    }
    return keepRecentEntries(out);
}

function sanitizeHabitLog(raw: unknown): Record<string, { count: number; allComplete: boolean }> {
    if (typeof raw !== 'object' || raw === null) return {};
    const out: Record<string, { count: number; allComplete: boolean }> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!isValidDateKey(k) || typeof v !== 'object' || v === null) continue;
        const entry = v as Record<string, unknown>;
        if (typeof entry.count !== 'number' || typeof entry.allComplete !== 'boolean') continue;
        const safeCount = nonNegativeInteger(entry.count);
        if (safeCount !== null) out[k] = { count: safeCount, allComplete: entry.allComplete };
    }
    return keepRecentEntries(out);
}

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
                if (!isValidDateKey(date)) return;
                const safeXp = nonNegativeInteger(xp);
                if (safeXp === null) return;
                set((state) => ({
                    taskXpLog: keepRecentEntries({
                        ...state.taskXpLog,
                        [date]: Math.min(
                            MAX_STATS_DAILY_VALUE,
                            (nonNegativeInteger(state.taskXpLog[date] || 0) ?? 0) + safeXp,
                        ),
                    }),
                }));
            },

            logHabitActivity: (date: string, count: number, allComplete: boolean) => {
                if (!isValidDateKey(date)) return;
                const safeCount = nonNegativeInteger(count);
                if (safeCount === null) return;
                set((state) => ({
                    habitLog: keepRecentEntries({
                        ...state.habitLog,
                        [date]: { count: safeCount, allComplete },
                    }),
                }));
            },
        }),
        {
            name: 'quest-board-stats',
            version: 1,
            merge: (persisted, current) => ({
                ...current,
                ...sanitizeStatsStoreState(persisted),
            }),
        }
    )
);
