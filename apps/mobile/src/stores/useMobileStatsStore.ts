/**
 * Mobile統計ログ（taskXpLog/habitLog）。Web useStatsStore のミラー。
 *
 * 実績（activeDays/perfectDays）の算出元。完了記録が後から削除されても
 * 実績の達成事実は変わらないため、現存データからの再構築ではなく
 * このログへの追記で運用する（core/statsLog参照）。
 *
 * 初回起動時（このログが未保存＝旧バージョンからの移行や新規インストール）
 * のみ、現存するtasks/habits/recordsから seedStatsLogFromCollections で
 * 一度だけ復元する。以後はログイベント（logTaskXp/logHabitActivity）で
 * 追記していく。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
    appendHabitActivity,
    appendTaskXp,
    sanitizeHabitLog,
    sanitizeTaskXpLog,
    seedStatsLogFromCollections,
    type HabitLog,
    type TaskXpLog,
} from '@life-quest/core/statsLog';
import type { Habit, HabitDailyRecord } from '@life-quest/core/habits';
import type { Task } from '@life-quest/core/tasks';

interface MobileStatsState {
    taskXpLog: TaskXpLog;
    habitLog: HabitLog;
    /** シード済みか（永続化される。falseの間だけ初回シードの余地がある） */
    seeded: boolean;
    hasHydrated: boolean;
    logTaskXp: (date: string, xp: number) => void;
    logHabitActivity: (date: string, count: number, allComplete: boolean) => void;
    /** 初回のみ現存コレクションからログを復元する（シード済みなら何もしない） */
    seedIfNeeded: (tasks: readonly Task[], habits: readonly Habit[], records: readonly HabitDailyRecord[]) => void;
    setHasHydrated: (value: boolean) => void;
}

interface StatsPersisted {
    taskXpLog: TaskXpLog;
    habitLog: HabitLog;
    seeded: boolean;
}

function sanitizePersisted(value: unknown): Partial<StatsPersisted> {
    if (typeof value !== 'object' || value === null) return {};
    const raw = value as Record<string, unknown>;
    return {
        taskXpLog: sanitizeTaskXpLog(raw.taskXpLog),
        habitLog: sanitizeHabitLog(raw.habitLog),
        seeded: raw.seeded === true,
    };
}

export const useMobileStatsStore = create<MobileStatsState>()(
    persist(
        (set, get) => ({
            taskXpLog: {},
            habitLog: {},
            seeded: false,
            hasHydrated: false,

            logTaskXp: (date, xp) => {
                set((state) => ({ taskXpLog: appendTaskXp(state.taskXpLog, date, xp) }));
            },

            logHabitActivity: (date, count, allComplete) => {
                set((state) => ({ habitLog: appendHabitActivity(state.habitLog, date, count, allComplete) }));
            },

            seedIfNeeded: (tasks, habits, records) => {
                if (get().seeded) return;
                const seed = seedStatsLogFromCollections(tasks, habits, records);
                set({ taskXpLog: seed.taskXpLog, habitLog: seed.habitLog, seeded: true });
            },

            setHasHydrated: (hasHydrated) => set({ hasHydrated }),
        }),
        {
            name: 'quest-board-mobile-stats',
            storage: createJSONStorage(() => AsyncStorage),
            version: 1,
            partialize: (state) => ({
                taskXpLog: state.taskXpLog,
                habitLog: state.habitLog,
                seeded: state.seeded,
            }),
            merge: (persisted, current) => ({ ...current, ...sanitizePersisted(persisted) }),
            onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
        },
    ),
);
