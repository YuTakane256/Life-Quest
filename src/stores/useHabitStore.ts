import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Habit, HabitDailyRecord, RestDay, HabitStoreState } from '../types';
import { XP_CONFIG } from '../config/gameConfig';
import { generateId, getTodayJST } from '../utils/dateUtils';

export const useHabitStore = create<HabitStoreState>()(
    persist(
        (set, get) => ({
            habits: [],
            dailyRecords: [],
            restDays: [],

            addHabit: (name: string) => {
                const newHabit: Habit = {
                    id: generateId(),
                    name,
                    createdAt: new Date().toISOString(),
                };
                set((state) => ({ habits: [...state.habits, newHabit] }));
            },

            deleteHabit: (id: string) => {
                set((state) => ({
                    habits: state.habits.filter((h) => h.id !== id),
                    dailyRecords: state.dailyRecords.filter((r) => r.habitId !== id),
                }));
            },

            toggleHabitCompletion: (habitId: string, date: string) => {
                const existingRecord = get().dailyRecords.find(
                    (r) => r.habitId === habitId && r.date === date
                );

                if (existingRecord) {
                    // トグル: completed を反転
                    set((state) => ({
                        dailyRecords: state.dailyRecords.map((r) =>
                            r.habitId === habitId && r.date === date
                                ? { ...r, completed: !r.completed }
                                : r
                        ),
                    }));
                } else {
                    // 新規レコード作成
                    const newRecord: HabitDailyRecord = {
                        habitId,
                        date,
                        completed: true,
                        memo: '',
                    };
                    set((state) => ({
                        dailyRecords: [...state.dailyRecords, newRecord],
                    }));
                }

                // 全習慣が完了したか確認して報酬付与
                // setTimeout で状態更新後に確認
                setTimeout(async () => {
                    const state = get();
                    const allComplete = state.areAllHabitsComplete(date);

                    // 統計ログ記録
                    const completedCount = state.dailyRecords.filter(
                        (r) => r.date === date && r.completed
                    ).length;
                    const statsStore = await import('./useStatsStore').then(m => m.useStatsStore);
                    statsStore.getState().logHabitActivity(date, completedCount, allComplete);

                    if (allComplete) {
                        // 全達成報酬を付与
                        const gameStore = await import('./useGameStore').then(m => m.useGameStore);
                        const store = gameStore.getState();
                        store.addXp(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS);
                        store.incrementGachaCount();
                        store.checkGachaMilestones();
                    }
                }, 0);
            },

            setHabitMemo: (habitId: string, date: string, memo: string) => {
                const existingRecord = get().dailyRecords.find(
                    (r) => r.habitId === habitId && r.date === date
                );

                if (existingRecord) {
                    set((state) => ({
                        dailyRecords: state.dailyRecords.map((r) =>
                            r.habitId === habitId && r.date === date
                                ? { ...r, memo }
                                : r
                        ),
                    }));
                } else {
                    // レコードがない場合は作成（未完了だがメモあり）
                    const newRecord: HabitDailyRecord = {
                        habitId,
                        date,
                        completed: false,
                        memo,
                    };
                    set((state) => ({
                        dailyRecords: [...state.dailyRecords, newRecord],
                    }));
                }
            },

            setRestDay: (date: string) => {
                const existing = get().restDays.find((r) => r.date === date);
                if (existing) {
                    set((state) => ({
                        restDays: state.restDays.map((r) =>
                            r.date === date ? { ...r, isRest: true } : r
                        ),
                    }));
                } else {
                    set((state) => ({
                        restDays: [...state.restDays, { date, isRest: true }],
                    }));
                }
            },

            isRestDay: (date: string) => {
                return get().restDays.some((r) => r.date === date && r.isRest);
            },

            getTodayRecords: () => {
                const today = getTodayJST();
                return get().dailyRecords.filter((r) => r.date === today);
            },

            areAllHabitsComplete: (date: string) => {
                const { habits, dailyRecords } = get();
                if (habits.length === 0) return false;
                return habits.every((habit) =>
                    dailyRecords.some(
                        (r) => r.habitId === habit.id && r.date === date && r.completed
                    )
                );
            },

            checkAndResetHabits: () => {
                // 古いレコードのクリーンアップ（30日以上前のものを削除）
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - 30);
                const cutoffStr = cutoffDate.toISOString().split('T')[0];

                set((state) => ({
                    dailyRecords: state.dailyRecords.filter((r) => r.date >= cutoffStr),
                    restDays: state.restDays.filter((r) => r.date >= cutoffStr),
                }));
            },
        }),
        {
            name: 'quest-board-habits',
        }
    )
);
