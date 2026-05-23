import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NotificationStoreState } from '../types';
import { NOTIFICATION_CONFIG } from '../config/gameConfig';

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
        }
    )
);
