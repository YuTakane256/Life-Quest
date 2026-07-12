import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createWebPersistStorage } from '../platform/storage';
import type { NotificationStoreState } from '../types';
import { NOTIFICATION_CONFIG, resolveHabitReminderHour } from '../core/notifications';
import { isFiniteNumber } from '../utils/persistSanitize';
import { isValidYmd } from '../utils/dateUtils';

export const MAX_NOTIFICATION_TASK_ID_LENGTH = 128;

/** リマインダー時刻（時）を 0-23 の整数に丸める（coreの共有ルール）。 */
const clampReminderHour = resolveHabitReminderHour;

function sanitizeTaskId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const id = value.trim();
    if (!id || id.length > MAX_NOTIFICATION_TASK_ID_LENGTH) return null;
    return id;
}

function sanitizeTaskIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .map(sanitizeTaskId)
            .filter((id): id is string => id !== null)
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

    if (raw.lastHabitReminderDate === null
        || (typeof raw.lastHabitReminderDate === 'string' && isValidYmd(raw.lastHabitReminderDate))) {
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

            setEnabled: (enabled: boolean) => set({ enabled: enabled === true }),

            setHabitReminderHour: (hour: number) => {
                set({ habitReminderHour: clampReminderHour(hour) });
            },

            markTaskNotified: (taskId: string) =>
                set((state) => {
                    const sanitizedId = sanitizeTaskId(taskId);
                    if (!sanitizedId || state.notifiedTaskIds.includes(sanitizedId)) return state;
                    return { notifiedTaskIds: sanitizeTaskIds([...state.notifiedTaskIds, sanitizedId]) };
                }),

            markHabitReminded: (date: string) => {
                if (!isValidYmd(date)) return;
                set({ lastHabitReminderDate: date });
            },

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
            storage: createWebPersistStorage(),
            version: 1,
            merge: (persisted, current) => ({ ...current, ...sanitizeNotificationState(persisted) }),
        }
    )
);
