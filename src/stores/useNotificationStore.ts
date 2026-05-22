import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NotificationStoreState } from '../types';

export const useNotificationStore = create<NotificationStoreState>()(
    persist(
        (set) => ({
            enabled: false,
            notifiedTaskIds: [],
            lastHabitReminderDate: null,

            setEnabled: (enabled: boolean) => set({ enabled }),

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
