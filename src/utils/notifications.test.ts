import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNotificationChecks } from './notifications';
import { NOTIFICATION_CONFIG } from '../config/gameConfig';
import { useHabitStore } from '../stores/useHabitStore';
import { useNotificationStore } from '../stores/useNotificationStore';
import { useTaskStore } from '../stores/useTaskStore';

class GrantedNotification {
    static permission: NotificationPermission = 'granted';
    static requestPermission = vi.fn();
}

function resetStores() {
    localStorage.clear();
    useTaskStore.setState({ tasks: [], pendingCompletions: [] });
    useHabitStore.setState({ habits: [], dailyRecords: [], restDays: [] });
    useNotificationStore.setState({
        enabled: true,
        notifiedTaskIds: [],
        lastHabitReminderDate: null,
        habitReminderHour: NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST,
    });
}

describe('runNotificationChecks', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-13T03:00:00.000Z'));
        resetStores();
        vi.stubGlobal('Notification', GrantedNotification);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('通知配信中に並行実行されても同じ期限通知を二重送信しない', async () => {
        let resolveNotification: () => void = () => undefined;
        const showNotification = vi.fn(
            () => new Promise<void>((resolve) => {
                resolveNotification = resolve;
            })
        );
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                getRegistration: vi.fn().mockResolvedValue({ showNotification }),
            },
        });

        useTaskStore.setState({
            tasks: [
                {
                    id: 'task-1',
                    name: '締切タスク',
                    dueDate: '2026-06-13',
                    priority: 'medium',
                    tags: [],
                    subtasks: [],
                    recurrence: 'none',
                    completed: false,
                    completedAt: null,
                    createdAt: '2026-06-13T00:00:00.000Z',
                },
            ],
            pendingCompletions: [],
        });

        const firstRun = runNotificationChecks();
        const secondRun = runNotificationChecks();

        await secondRun;
        expect(showNotification).toHaveBeenCalledTimes(1);

        resolveNotification();
        await firstRun;

        expect(showNotification).toHaveBeenCalledTimes(1);
        expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['task-1']);
    });

    it('不正な dueDate のタスクは期限通知せず通知済みにもしない', async () => {
        const showNotification = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                getRegistration: vi.fn().mockResolvedValue({ showNotification }),
            },
        });

        useTaskStore.setState({
            tasks: [
                {
                    id: 'task-invalid-date',
                    name: '壊れた締切タスク',
                    dueDate: '2026-02-30',
                    priority: 'medium',
                    tags: [],
                    subtasks: [],
                    recurrence: 'none',
                    completed: false,
                    completedAt: null,
                    createdAt: '2026-06-13T00:00:00.000Z',
                },
            ],
            pendingCompletions: [],
        });

        await runNotificationChecks();

        expect(showNotification).not.toHaveBeenCalled();
        expect(useNotificationStore.getState().notifiedTaskIds).toEqual([]);
    });
});
