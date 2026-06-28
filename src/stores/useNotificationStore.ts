import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NotificationStoreState } from '../types';
import { NOTIFICATION_CONFIG } from '../config/gameConfig';
import { clamp } from '../utils/numeric';
import { isFiniteNumber } from '../utils/persistSanitize';

const MIN_REMINDER_HOUR = 0;
const MAX_REMINDER_HOUR = 23;

/** リマインダー時刻（時）を 0-23 の整数に丸める。 */
function clampReminderHour(hour: number): number {
    return clamp(Math.floor(hour), MIN_REMINDER_HOUR, MAX_REMINDER_HOUR);
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateKey(value: unknown): value is string {
    return typeof value === 'string' && DATE_KEY_PATTERN.test(value);
}

function sanitizeTaskIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .filter((id): id is string => typeof id === 'string')
            .map((id) => id.trim())
            .filter(Boolean)
    )).slice(-NOTIFICATION_CONFIG.MAX_NOTIFIED_TASK_IDS);
}

/** 永続化された state を信用せず、各フィールドの型/範囲を検証して既定値にフォールバック */
export function sanitizeNotificationState(persisted: unknown): Partial<NotificationStoreState> {
    if (typeof persisted !== 'object' || persisted === null) return {};
    const raw = persisted as Record<string, unknown>;
    const result: Partial<NotificationStoreState> = {};

    if (typeof raw.enabled === 'boolean') result.enabled = raw.enabled;

    if (Array.isArray(raw.notifiedTaskIds)) {
        result.notifiedTaskIds = sanitizeTaskIds(raw.notifiedTaskIds);
    }

    if (raw.lastHabitReminderDate === null || isValidDateKey(raw.lastHabitReminderDate)) {
        result.lastHabitReminderDate = raw.lastHabitReminderDate;
    }

    if (isFiniteNumber(raw.habitReminderHour)) {
        result.habitReminderHour = clampReminderHour(raw.habitReminderHour);
    }

    return result;
}

export const useNotificationStore = create<NotificationStoreState>()(
    persist(
        (set) => ({
            enabled: false,
            notifiedTaskIds: [],
            lastHabitReminderDate: null,
            habitReminderHour: NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST,

            setEnabled: (enabled: boolean) => set({ enabled }),

            setHabitReminderHour: (hour: number) => {
                set({ habitReminderHour: clampReminderHour(hour) });
            },

            markTaskNotified: (taskId: string) =>
                set((state) => {
                    const sanitizedId = taskId.trim();
                    if (!sanitizedId || state.notifiedTaskIds.includes(sanitizedId)) return state;
                    return { notifiedTaskIds: sanitizeTaskIds([...state.notifiedTaskIds, sanitizedId]) };
                }),

            markHabitReminded: (date: string) => set({ lastHabitReminderDate: date }),

            pruneNotifiedTasks: (validTaskIds: string[]) =>
                set((state) => {
                    const validIds = new Set(sanitizeTaskIds(validTaskIds));
                    return {
                        notifiedTaskIds: state.notifiedTaskIds.filter((id) => validIds.has(id)),
                    };
                }),
        }),
        {
            name: 'quest-board-notifications',
            version: 1,
            merge: (persisted, current) => ({ ...current, ...sanitizeNotificationState(persisted) }),
        }
    )
);
