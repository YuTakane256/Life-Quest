import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    createHabit,
    HABIT_LIMITS,
    removeHabitData,
    sanitizeHabitCollection,
    sanitizeHabitRecords,
    toggleHabitDailyRecord,
    type Habit,
    type HabitDailyRecord,
} from '@life-quest/core/habits';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface MobileHabitStore {
    habits: Habit[];
    records: HabitDailyRecord[];
    hasHydrated: boolean;
    addHabit: (name: string) => boolean;
    toggleToday: (habitId: string, date: string) => void;
    deleteHabit: (habitId: string) => void;
    setHasHydrated: (value: boolean) => void;
}

function createMobileId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useMobileHabitStore = create<MobileHabitStore>()(
    persist(
        (set, get) => ({
            habits: [],
            records: [],
            hasHydrated: false,
            addHabit: (name) => {
                if (get().habits.length >= HABIT_LIMITS.maxHabits) return false;
                const habit = createHabit(createMobileId(), name, 'general', new Date().toISOString());
                if (!habit) return false;
                set((state) => ({ habits: [...state.habits, habit] }));
                return true;
            },
            toggleToday: (habitId, date) => set((state) => ({
                records: toggleHabitDailyRecord(state.records, habitId, date),
            })),
            deleteHabit: (habitId) => set((state) => removeHabitData(state.habits, state.records, habitId)),
            setHasHydrated: (hasHydrated) => set({ hasHydrated }),
        }),
        {
            name: 'quest-board-habits',
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state) => ({ habits: state.habits, records: state.records }),
            merge: (persisted, current) => {
                const value = typeof persisted === 'object' && persisted !== null
                    ? persisted as { habits?: unknown; records?: unknown }
                    : {};
                const habits = sanitizeHabitCollection(value.habits);
                const records = sanitizeHabitRecords(value.records, new Set(habits.map((habit) => habit.id)));
                return { ...current, habits, records };
            },
            onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
        }
    )
);
