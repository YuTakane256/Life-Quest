import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    areAllHabitsComplete,
    createHabit,
    getHabitCategoryByIdOrDefault,
    HABIT_LIMITS,
    markRestDay,
    removeHabitData,
    sanitizeHabitCollection,
    sanitizeHabitRecords,
    sanitizeRestDays,
    toggleHabitDailyRecord,
    type Habit,
    type HabitDailyRecord,
    type RestDay,
} from '@life-quest/core/habits';
import { GAME_STATE_LIMITS } from '@life-quest/core/gameState';
import { clampString } from '@life-quest/core/validation';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createMobileId } from '../utils/createMobileId';
import { enqueueCloudOperation } from '../platform/cloudOutbox';
import { useMobileGameStore } from './useMobileGameStore';
import { useMobileStatsStore } from './useMobileStatsStore';

/** お休み日の最大保持数（Webと同じ上限） */
export const MAX_HABIT_REST_DAYS = 3660;

interface MobileHabitStore {
    habits: Habit[];
    records: HabitDailyRecord[];
    restDays: RestDay[];
    /** 全習慣達成が成立し、ゲームストアと再照合可能な日付。 */
    rewardEligibleDates: string[];
    hasHydrated: boolean;
    addHabit: (name: string, categoryId?: string) => boolean;
    toggleToday: (habitId: string, date: string) => void;
    setHabitMemo: (habitId: string, date: string, memo: string) => void;
    markRestDay: (date: string) => void;
    deleteHabit: (habitId: string) => void;
    setHasHydrated: (value: boolean) => void;
}

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeRewardEligibleDates(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((date): date is string =>
        typeof date === 'string' && YMD_PATTERN.test(date)
    ))].slice(-GAME_STATE_LIMITS.maxHabitBonusDates);
}

export const useMobileHabitStore = create<MobileHabitStore>()(
    persist(
        (set, get) => ({
            habits: [],
            records: [],
            restDays: [],
            rewardEligibleDates: [],
            hasHydrated: false,
            addHabit: (name, categoryId) => {
                if (!get().hasHydrated || get().habits.length >= HABIT_LIMITS.maxHabits) return false;
                // 不明なカテゴリはWebと同じく「その他」へフォールバック
                const category = getHabitCategoryByIdOrDefault(categoryId).id;
                const habit = createHabit(createMobileId(), name, category, new Date().toISOString());
                if (!habit) return false;
                set((state) => ({ habits: [...state.habits, habit] }));
                void enqueueCloudOperation('upsert_habit', {
                    p_id: habit.id,
                    p_name: habit.name,
                    p_category_id: habit.categoryId,
                }, { trackEntityId: habit.id });
                return true;
            },
            toggleToday: (habitId, date) => {
                const before = get();
                if (!before.hasHydrated || !before.habits.some((habit) => habit.id === habitId)) return;

                set((state) => {
                    const records = toggleHabitDailyRecord(state.records, habitId, date);
                    const becameEligible = areAllHabitsComplete(state.habits, records, date)
                        && !state.rewardEligibleDates.includes(date);
                    return {
                        records,
                        rewardEligibleDates: becameEligible
                            ? [...state.rewardEligibleDates, date].slice(-GAME_STATE_LIMITS.maxHabitBonusDates)
                            : state.rewardEligibleDates,
                    };
                });

                // 受給資格は習慣データと同じ書き込みで保存し、報酬台帳と再照合する。
                const eligible = get().rewardEligibleDates.includes(date);
                if (eligible) {
                    useMobileGameStore.getState().grantHabitAllCompleteBonus(date);
                }

                // 統計ログ記録（Web useHabitStore.ts と同一の計算。報酬の可否に関わらず
                // その日の状態をそのまま記録する＝上書き。Undo等で戻した場合も直近状態を反映）
                const after = get();
                const record = after.records.find((r) => r.habitId === habitId && r.date === date);
                const completedCount = after.records.filter(
                    (record) => record.date === date && record.completed
                ).length;
                const allComplete = areAllHabitsComplete(after.habits, after.records, date);
                useMobileStatsStore.getState().logHabitActivity(date, completedCount, allComplete);

                // クラウドへcompleted/memoの絶対状態を送る（set_habit_logはサーバー側で
                // stats_daily.habit_countも継続更新する）。全達成報酬(claim_habit_bonus)は
                // サーバーが更新後のhabit_logsで検証するため、set_habit_logの後に
                // 依存させて送る（pendingEntityOpsのhabitIdキーを使い回し、直前opの
                // 完了を待たせる）。
                void (async () => {
                    await enqueueCloudOperation('set_habit_log', {
                        p_habit_id: habitId,
                        p_date: date,
                        p_completed: record?.completed ?? false,
                        p_memo: record?.memo ?? '',
                    }, { dependsOnEntityIds: [habitId], trackEntityId: habitId });

                    if (eligible) {
                        await enqueueCloudOperation('claim_habit_bonus', { date }, { dependsOnEntityIds: [habitId] });
                    }
                })();
            },
            setHabitMemo: (habitId, date, memo) => {
                const state = get();
                if (!state.hasHydrated || !YMD_PATTERN.test(date)) return;
                if (!state.habits.some((habit) => habit.id === habitId)) return;
                const safeMemo = clampString(memo, HABIT_LIMITS.maxMemoLength);
                const existing = state.records.find(
                    (record) => record.habitId === habitId && record.date === date,
                );

                set((current) => ({
                    records: existing
                        ? current.records.map((record) =>
                            record.habitId === habitId && record.date === date
                                ? { ...record, memo: safeMemo }
                                : record)
                        : [...current.records, { habitId, date, completed: false, memo: safeMemo }]
                            .slice(-HABIT_LIMITS.maxRecords),
                }));

                void enqueueCloudOperation('set_habit_log', {
                    p_habit_id: habitId,
                    p_date: date,
                    p_completed: existing?.completed ?? false,
                    p_memo: safeMemo,
                }, { dependsOnEntityIds: [habitId], trackEntityId: habitId });
            },
            markRestDay: (date) => {
                if (!get().hasHydrated) return;
                set((state) => ({ restDays: markRestDay(state.restDays, date, MAX_HABIT_REST_DAYS) }));
                void enqueueCloudOperation('set_rest_day', { p_date: date, p_active: true });
            },
            deleteHabit: (habitId) => {
                if (!get().hasHydrated) return;
                set((state) => removeHabitData(state.habits, state.records, habitId));
                void enqueueCloudOperation('delete_habit', { p_id: habitId }, { dependsOnEntityIds: [habitId] });
            },
            setHasHydrated: (hasHydrated) => set({ hasHydrated }),
        }),
        {
            name: 'quest-board-habits',
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state) => ({
                habits: state.habits,
                records: state.records,
                restDays: state.restDays,
                rewardEligibleDates: state.rewardEligibleDates,
            }),
            merge: (persisted, current) => {
                const value = typeof persisted === 'object' && persisted !== null
                    ? persisted as { habits?: unknown; records?: unknown; restDays?: unknown; rewardEligibleDates?: unknown }
                    : {};
                const habits = sanitizeHabitCollection(value.habits);
                const records = sanitizeHabitRecords(value.records, new Set(habits.map((habit) => habit.id)));
                return {
                    ...current,
                    habits,
                    records,
                    restDays: sanitizeRestDays(value.restDays, MAX_HABIT_REST_DAYS),
                    rewardEligibleDates: sanitizeRewardEligibleDates(value.rewardEligibleDates),
                };
            },
            onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
        }
    )
);
