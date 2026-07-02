import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    areAllHabitsComplete,
    createHabit,
    HABIT_LIMITS,
    removeHabitData,
    sanitizeHabitCollection,
    sanitizeHabitRecords,
    toggleHabitDailyRecord,
    type Habit,
    type HabitDailyRecord,
} from '@life-quest/core/habits';
import { GAME_STATE_LIMITS } from '@life-quest/core/gameState';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createMobileId } from '../utils/createMobileId';
import { useMobileGameStore } from './useMobileGameStore';

interface MobileHabitStore {
    habits: Habit[];
    records: HabitDailyRecord[];
    /** 全習慣達成が成立し、ゲームストアと再照合可能な日付。 */
    rewardEligibleDates: string[];
    hasHydrated: boolean;
    addHabit: (name: string) => boolean;
    toggleToday: (habitId: string, date: string) => void;
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
            rewardEligibleDates: [],
            hasHydrated: false,
            addHabit: (name) => {
                if (!get().hasHydrated || get().habits.length >= HABIT_LIMITS.maxHabits) return false;
                const habit = createHabit(createMobileId(), name, 'general', new Date().toISOString());
                if (!habit) return false;
                set((state) => ({ habits: [...state.habits, habit] }));
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
                if (get().rewardEligibleDates.includes(date)) {
                    useMobileGameStore.getState().grantHabitAllCompleteBonus(date);
                }
            },
            deleteHabit: (habitId) => {
                if (!get().hasHydrated) return;
                set((state) => removeHabitData(state.habits, state.records, habitId));
            },
            setHasHydrated: (hasHydrated) => set({ hasHydrated }),
        }),
        {
            name: 'quest-board-habits',
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state) => ({
                habits: state.habits,
                records: state.records,
                rewardEligibleDates: state.rewardEligibleDates,
            }),
            merge: (persisted, current) => {
                const value = typeof persisted === 'object' && persisted !== null
                    ? persisted as { habits?: unknown; records?: unknown; rewardEligibleDates?: unknown }
                    : {};
                const habits = sanitizeHabitCollection(value.habits);
                const records = sanitizeHabitRecords(value.records, new Set(habits.map((habit) => habit.id)));
                return {
                    ...current,
                    habits,
                    records,
                    rewardEligibleDates: sanitizeRewardEligibleDates(value.rewardEligibleDates),
                };
            },
            onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
        }
    )
);
