import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Habit, HabitDailyRecord, HabitStoreState, RestDay } from '../types';
import { XP_CONFIG, UI_CONFIG } from '../config/gameConfig';
import { DEFAULT_CATEGORY_ID, HABIT_CATEGORIES } from '../config/habitCategories';
import { generateId, getTodayJST, isValidYmd, shiftDate } from '../utils/dateUtils';
import { clampString } from '../utils/validation';
import { isPlainObject, sanitizeTimestamp, sanitizeNullableYmd } from '../utils/persistSanitize';

interface HabitStorePersisted {
    habits: Habit[];
    dailyRecords: HabitDailyRecord[];
    restDays: RestDay[];
    allCompleteRewardDates: string[];
}

const VALID_CATEGORY_IDS = new Set(HABIT_CATEGORIES.map((category) => category.id));

function sanitizeHabit(raw: unknown): Habit | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;

    const categoryId = typeof raw.categoryId === 'string' && VALID_CATEGORY_IDS.has(raw.categoryId)
        ? raw.categoryId
        : DEFAULT_CATEGORY_ID;

    return {
        id: raw.id,
        name: clampString(raw.name, UI_CONFIG.MAX_HABIT_NAME_LENGTH),
        categoryId,
        createdAt: sanitizeTimestamp(raw.createdAt),
    };
}

function sanitizeDailyRecord(raw: unknown, validHabitIds: Set<string>): HabitDailyRecord | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.habitId !== 'string' || !validHabitIds.has(raw.habitId)) return null;
    if (typeof raw.date !== 'string' || !isValidYmd(raw.date)) return null;

    return {
        habitId: raw.habitId,
        date: raw.date,
        completed: typeof raw.completed === 'boolean' ? raw.completed : false,
        memo: typeof raw.memo === 'string' ? clampString(raw.memo, UI_CONFIG.MAX_HABIT_MEMO_LENGTH) : '',
    };
}

function sanitizeRestDay(raw: unknown): RestDay | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.date !== 'string' || !isValidYmd(raw.date)) return null;

    return {
        date: raw.date,
        isRest: typeof raw.isRest === 'boolean' ? raw.isRest : false,
    };
}

export function sanitizeHabitStoreState(persisted: unknown): HabitStorePersisted {
    if (!isPlainObject(persisted)) {
        return { habits: [], dailyRecords: [], restDays: [], allCompleteRewardDates: [] };
    }

    const habits = Array.isArray(persisted.habits)
        ? persisted.habits.map(sanitizeHabit).filter((habit): habit is Habit => habit !== null)
        : [];
    const validHabitIds = new Set(habits.map((habit) => habit.id));

    return {
        habits,
        dailyRecords: Array.isArray(persisted.dailyRecords)
            ? persisted.dailyRecords
                .map((record) => sanitizeDailyRecord(record, validHabitIds))
                .filter((record): record is HabitDailyRecord => record !== null)
            : [],
        restDays: Array.isArray(persisted.restDays)
            ? persisted.restDays.map(sanitizeRestDay).filter((restDay): restDay is RestDay => restDay !== null)
            : [],
        allCompleteRewardDates: Array.isArray(persisted.allCompleteRewardDates)
            ? Array.from(new Set(
                persisted.allCompleteRewardDates
                    .map(sanitizeNullableYmd)
                    .filter((date): date is string => date !== null)
            ))
            : [],
    };
}

export const useHabitStore = create<HabitStoreState>()(
    persist(
        (set, get) => ({
            habits: [],
            dailyRecords: [],
            restDays: [],
            allCompleteRewardDates: [],

            addHabit: (name: string, categoryId?: string) => {
                const newHabit: Habit = {
                    id: generateId(),
                    name: clampString(name, UI_CONFIG.MAX_HABIT_NAME_LENGTH),
                    categoryId: categoryId || DEFAULT_CATEGORY_ID,
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
                        let shouldAwardReward = false;
                        set((latest) => ({
                            allCompleteRewardDates: latest.allCompleteRewardDates.includes(date)
                                ? latest.allCompleteRewardDates
                                : (() => {
                                    shouldAwardReward = true;
                                    return [...latest.allCompleteRewardDates, date];
                                })(),
                        }));
                        if (!shouldAwardReward) return;

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
                const safeMemo = clampString(memo, UI_CONFIG.MAX_HABIT_MEMO_LENGTH);
                const existingRecord = get().dailyRecords.find(
                    (r) => r.habitId === habitId && r.date === date
                );

                if (existingRecord) {
                    set((state) => ({
                        dailyRecords: state.dailyRecords.map((r) =>
                            r.habitId === habitId && r.date === date
                                ? { ...r, memo: safeMemo }
                                : r
                        ),
                    }));
                } else {
                    // レコードがない場合は作成（未完了だがメモあり）
                    const newRecord: HabitDailyRecord = {
                        habitId,
                        date,
                        completed: false,
                        memo: safeMemo,
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
                return habits.every((habit) => {
                    // 指定日より後に作成された習慣は達成の必要なしとみなす
                    const createdDate = habit.createdAt.split('T')[0];
                    if (date < createdDate) return true;

                    return dailyRecords.some(
                        (r) => r.habitId === habit.id && r.date === date && r.completed
                    );
                });
            },

            getHabitStreak: (habitId: string) => {
                const { dailyRecords, restDays } = get();
                const today = getTodayJST();
                let streak = 0;
                let cursor = today;

                const habit = get().habits.find((h) => h.id === habitId);
                if (!habit) return 0;
                const createdDate = habit.createdAt.split('T')[0];

                // 今日から過去へ遡って連続達成日数を数える。
                // dailyRecords は30日でクリーンアップされるため最大31日まで遡れば十分。
                for (let i = 0; i < 31; i++) {
                    if (cursor < createdDate) break;

                    const isRest = restDays.some((r) => r.date === cursor && r.isRest);
                    if (isRest) {
                        // お休み日はストリークを途切れさせず、カウントもしない
                        cursor = shiftDate(cursor, -1);
                        continue;
                    }

                    const completed = dailyRecords.some(
                        (r) => r.habitId === habitId && r.date === cursor && r.completed
                    );
                    if (completed) {
                        streak++;
                    } else if (cursor === today) {
                        // 今日はまだ未完了でも連続を途切れさせない（過去分のストリークを表示）
                    } else {
                        break;
                    }
                    cursor = shiftDate(cursor, -1);
                }
                return streak;
            },

            getHabitCompletionRate: (habitId: string) => {
                const { habits, dailyRecords, restDays } = get();
                const habit = habits.find((h) => h.id === habitId);
                if (!habit) return null;

                const createdDate = habit.createdAt.split('T')[0];
                const today = getTodayJST();
                let total = 0;
                let completed = 0;

                // 今日から過去30日を遡る。習慣の作成前とお休み日は分母に含めない。
                for (let i = 0; i < 30; i++) {
                    const date = shiftDate(today, -i);
                    if (date < createdDate) break;
                    if (restDays.some((r) => r.date === date && r.isRest)) continue;
                    total++;
                    if (dailyRecords.some((r) => r.habitId === habitId && r.date === date && r.completed)) {
                        completed++;
                    }
                }

                if (total === 0) return null;
                return Math.round((completed / total) * 100);
            },

            checkAndResetHabits: () => {
                // 古いレコードのクリーンアップ（30日以上前のものを削除）。
                // dailyRecords / restDays は JST 日付（YYYY-MM-DD）で保存されているので、
                // cutoff も JST ベースで計算する（UTC ベースだと JST 深夜 0-9 時に 1 日ずれる）。
                const cutoffStr = shiftDate(getTodayJST(), -30);

                set((state) => ({
                    dailyRecords: state.dailyRecords.filter((r) => r.date >= cutoffStr),
                    restDays: state.restDays.filter((r) => r.date >= cutoffStr),
                    allCompleteRewardDates: state.allCompleteRewardDates.filter((date) => date >= cutoffStr),
                }));
            },
        }),
        {
            name: 'quest-board-habits',
            merge: (persisted, current) => ({
                ...current,
                ...sanitizeHabitStoreState(persisted),
            }),
        }
    )
);
