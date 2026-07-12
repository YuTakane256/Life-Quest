import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { NOTIFICATION_CONFIG, resolveHabitReminderHour } from '@life-quest/core/notifications';

export type MobileThemeMode = 'light' | 'dark' | 'system';
export type MobileMotionMode = 'system' | 'standard' | 'reduced';

const THEME_MODES: readonly MobileThemeMode[] = ['light', 'dark', 'system'];
const MOTION_MODES: readonly MobileMotionMode[] = ['system', 'standard', 'reduced'];

/** Web useNotificationStore と同じ上限（越境データ・肥大化への防御） */
const MAX_NOTIFICATION_TASK_ID_LENGTH = 128;
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function sanitizeMobileThemeMode(value: unknown): MobileThemeMode {
    return THEME_MODES.includes(value as MobileThemeMode) ? (value as MobileThemeMode) : 'system';
}

export function sanitizeMobileMotionMode(value: unknown): MobileMotionMode {
    return MOTION_MODES.includes(value as MobileMotionMode) ? (value as MobileMotionMode) : 'system';
}

/** リマインダー時刻（時）を 0-23 の整数に丸める（coreの共有ルール）。 */
export function clampReminderHour(value: unknown): number {
    // 旧実装は Number(value) で数値文字列も受けていたため互換を維持する
    const numberValue = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return resolveHabitReminderHour(numberValue);
}

function sanitizeTaskId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const id = value.trim();
    if (!id || id.length > MAX_NOTIFICATION_TASK_ID_LENGTH) return null;
    return id;
}

function sanitizeTaskIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value.map(sanitizeTaskId).filter((id): id is string => id !== null)
    )).slice(-NOTIFICATION_CONFIG.MAX_NOTIFIED_TASK_IDS);
}

interface MobileSettingsState {
    themeMode: MobileThemeMode;
    motionMode: MobileMotionMode;
    notificationsEnabled: boolean;
    habitReminderHour: number;
    /** 通知済みタスクID（重複通知防止。Web useNotificationStore と同じ意味） */
    notifiedTaskIds: string[];
    /** 習慣リマインダーを最後に送った日（YYYY-MM-DD） */
    lastHabitReminderDate: string | null;
    hasHydrated: boolean;
    setThemeMode: (mode: MobileThemeMode) => void;
    setMotionMode: (mode: MobileMotionMode) => void;
    setNotificationsEnabled: (enabled: boolean) => void;
    setHabitReminderHour: (hour: number) => void;
    markTaskNotified: (taskId: string) => void;
    markHabitReminded: (date: string) => void;
    pruneNotifiedTasks: (validTaskIds: string[]) => void;
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
        notifiedTaskIds: sanitizeTaskIds(raw.notifiedTaskIds),
        lastHabitReminderDate:
            typeof raw.lastHabitReminderDate === 'string' && YMD_PATTERN.test(raw.lastHabitReminderDate)
                ? raw.lastHabitReminderDate
                : null,
    };
}

export const useMobileSettingsStore = create<MobileSettingsState>()(
    persist(
        (set) => ({
            themeMode: 'system',
            motionMode: 'system',
            notificationsEnabled: false,
            habitReminderHour: 20,
            notifiedTaskIds: [],
            lastHabitReminderDate: null,
            hasHydrated: false,
            setThemeMode: (mode) => set({ themeMode: sanitizeMobileThemeMode(mode) }),
            setMotionMode: (mode) => set({ motionMode: sanitizeMobileMotionMode(mode) }),
            setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled === true }),
            setHabitReminderHour: (hour) => set({ habitReminderHour: clampReminderHour(hour) }),
            markTaskNotified: (taskId) =>
                set((state) => {
                    const sanitizedId = sanitizeTaskId(taskId);
                    if (!sanitizedId || state.notifiedTaskIds.includes(sanitizedId)) return state;
                    return { notifiedTaskIds: sanitizeTaskIds([...state.notifiedTaskIds, sanitizedId]) };
                }),
            markHabitReminded: (date) => {
                if (!YMD_PATTERN.test(date)) return;
                set({ lastHabitReminderDate: date });
            },
            pruneNotifiedTasks: (validTaskIds) =>
                set((state) => {
                    const validIds = new Set(sanitizeTaskIds(validTaskIds));
                    return { notifiedTaskIds: state.notifiedTaskIds.filter((id) => validIds.has(id)) };
                }),
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
                notifiedTaskIds: state.notifiedTaskIds,
                lastHabitReminderDate: state.lastHabitReminderDate,
            }),
            merge: (persisted, current) => ({ ...current, ...sanitizePersisted(persisted) }),
            onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
        },
    ),
);
