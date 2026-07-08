import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type MobileThemeMode = 'light' | 'dark' | 'system';
export type MobileMotionMode = 'system' | 'standard' | 'reduced';

const THEME_MODES: readonly MobileThemeMode[] = ['light', 'dark', 'system'];
const MOTION_MODES: readonly MobileMotionMode[] = ['system', 'standard', 'reduced'];

export function sanitizeMobileThemeMode(value: unknown): MobileThemeMode {
    return THEME_MODES.includes(value as MobileThemeMode) ? (value as MobileThemeMode) : 'system';
}

export function sanitizeMobileMotionMode(value: unknown): MobileMotionMode {
    return MOTION_MODES.includes(value as MobileMotionMode) ? (value as MobileMotionMode) : 'system';
}

export function clampReminderHour(value: unknown): number {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return 20;
    return Math.min(23, Math.max(0, Math.floor(numberValue)));
}

interface MobileSettingsState {
    themeMode: MobileThemeMode;
    motionMode: MobileMotionMode;
    notificationsEnabled: boolean;
    habitReminderHour: number;
    hasHydrated: boolean;
    setThemeMode: (mode: MobileThemeMode) => void;
    setMotionMode: (mode: MobileMotionMode) => void;
    setNotificationsEnabled: (enabled: boolean) => void;
    setHabitReminderHour: (hour: number) => void;
    setHasHydrated: (value: boolean) => void;
}

function sanitizePersisted(value: unknown): Partial<MobileSettingsState> {
    if (typeof value !== 'object' || value === null) return {};
    const raw = value as Record<string, unknown>;
    return {
        themeMode: sanitizeMobileThemeMode(raw.themeMode),
        motionMode: sanitizeMobileMotionMode(raw.motionMode),
        notificationsEnabled: raw.notificationsEnabled === true,
        habitReminderHour: clampReminderHour(raw.habitReminderHour),
    };
}

export const useMobileSettingsStore = create<MobileSettingsState>()(
    persist(
        (set) => ({
            themeMode: 'system',
            motionMode: 'system',
            notificationsEnabled: false,
            habitReminderHour: 20,
            hasHydrated: false,
            setThemeMode: (mode) => set({ themeMode: sanitizeMobileThemeMode(mode) }),
            setMotionMode: (mode) => set({ motionMode: sanitizeMobileMotionMode(mode) }),
            setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled === true }),
            setHabitReminderHour: (hour) => set({ habitReminderHour: clampReminderHour(hour) }),
            setHasHydrated: (hasHydrated) => set({ hasHydrated }),
        }),
        {
            name: 'quest-board-mobile-settings',
            storage: createJSONStorage(() => AsyncStorage),
            version: 1,
            partialize: (state) => ({
                themeMode: state.themeMode,
                motionMode: state.motionMode,
                notificationsEnabled: state.notificationsEnabled,
                habitReminderHour: state.habitReminderHour,
            }),
            merge: (persisted, current) => ({ ...current, ...sanitizePersisted(persisted) }),
            onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
        },
    ),
);
