import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NotificationStoreState } from '../types';
import { NOTIFICATION_CONFIG } from '../config/gameConfig';

/** 永続化された state を信用せず、各フィールドの型/範囲を検証して既定値にフォールバック */
export function sanitizeNotificationState(persisted: unknown): Partial<NotificationStoreState> {
    if (typeof persisted !== 'object' || persisted === null) return {};
    const raw = persisted as Record<string, unknown>;
    const result: Partial<NotificationStoreState> = {};

    if (typeof raw.enabled === 'boolean') result.enabled = raw.enabled;

    if (Array.isArray(raw.notifiedTaskIds)) {
        result.notifiedTaskIds = raw.notifiedTaskIds.filter((id): id is string => typeof id === 'string');
    }

    if (typeof raw.lastHabitReminderDate === 'string' || raw.lastHabitReminderDate === null) {
        result.lastHabitReminderDate = raw.lastHabitReminderDate;
    }

    if (typeof raw.habitReminderHour === 'number' && Number.isFinite(raw.habitReminderHour)) {
        result.habitReminderHour = Math.max(0, Math.min(23, Math.floor(raw.habitReminderHour)));
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
                // 0-23 の範囲にクランプ
                const clamped = Math.max(0, Math.min(23, Math.floor(hour)));
                set({ habitReminderHour: clamped });
            },

            markTaskNotified: (taskId: string) =>
                set((state) =>
                    state.notifiedTaskIds.includes(taskId)
                        ? state
                        : { notifiedTaskIds: [...state.notifiedTaskIds, taskId] }
                ),

            markHabitReminded: (date: string) => set({ lastHabitReminderDate: date }),

            pruneNotifiedTasks: (validTaskIds: string[]) =>
                set((state) => ({
                    notifiedTaskIds: state.notifiedTaskIds.filter((id) => validTaskIds.includes(id)),
                })),
        }),
        {
            name: 'quest-board-notifications',
            version: 1,
            merge: (persisted, current) => ({ ...current, ...sanitizeNotificationState(persisted) }),
        }
    )
);
