import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getNotificationPermission,
    isNotificationSupported,
    requestNotificationPermission,
    resolveHabitReminderHour,
    runNotificationChecks,
} from './notifications';
import { NOTIFICATION_CONFIG } from '../config/gameConfig';
import { useHabitStore } from '../stores/useHabitStore';
import { useNotificationStore } from '../stores/useNotificationStore';
import { useTaskStore } from '../stores/useTaskStore';

class GrantedNotification {
    static permission: NotificationPermission = 'granted';
    static requestPermission = vi.fn();
}

class RecordingNotification {
    static permission: NotificationPermission = 'granted';
    static requestPermission = vi.fn();
    static calls: Array<{ title: string; options: NotificationOptions }> = [];

    constructor(title: string, options: NotificationOptions) {
        RecordingNotification.calls.push({ title, options });
    }
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
        RecordingNotification.calls = [];
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

        await Promise.resolve();
        await Promise.resolve();
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

    it('Service Worker通知が失敗したタスクは通知済みにせず再試行可能にする', async () => {
        const showNotification = vi.fn().mockRejectedValue(new Error('delivery failed'));
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: { getRegistration: vi.fn().mockResolvedValue({ showNotification }) },
        });
        useTaskStore.setState({
            tasks: [{
                id: 'task-retry',
                name: '再試行するタスク',
                dueDate: '2026-06-13',
                priority: 'medium',
                tags: [],
                subtasks: [],
                recurrence: 'none',
                completed: false,
                completedAt: null,
                createdAt: '2026-06-13T00:00:00.000Z',
            }],
            pendingCompletions: [],
        });

        await runNotificationChecks();

        expect(showNotification).toHaveBeenCalledTimes(1);
        expect(useNotificationStore.getState().notifiedTaskIds).toEqual([]);
    });

    it('Notification constructorが失敗したタスクも通知済みにしない', async () => {
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
        vi.stubGlobal('Notification', class FailingNotification {
            static permission: NotificationPermission = 'granted';
            constructor() {
                throw new Error('constructor failed');
            }
        });
        useTaskStore.setState({
            tasks: [{
                id: 'task-constructor-failure',
                name: '通常通知失敗',
                dueDate: '2026-06-13',
                priority: 'medium',
                tags: [],
                subtasks: [],
                recurrence: 'none',
                completed: false,
                completedAt: null,
                createdAt: '2026-06-13T00:00:00.000Z',
            }],
            pendingCompletions: [],
        });

        await runNotificationChecks();

        expect(useNotificationStore.getState().notifiedTaskIds).toEqual([]);
    });

    it('Service Worker registration取得に失敗したら通常Notificationへフォールバックする', async () => {
        vi.stubGlobal('Notification', RecordingNotification);
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                getRegistration: vi.fn().mockRejectedValue(new Error('registration unavailable')),
            },
        });
        useTaskStore.setState({
            tasks: [{
                id: 'task-fallback',
                name: '通常通知へフォールバック',
                dueDate: '2026-06-13',
                priority: 'medium',
                tags: [],
                subtasks: [],
                recurrence: 'none',
                completed: false,
                completedAt: null,
                createdAt: '2026-06-13T00:00:00.000Z',
            }],
            pendingCompletions: [],
        });

        await runNotificationChecks();

        expect(RecordingNotification.calls).toHaveLength(1);
        expect(RecordingNotification.calls[0]).toMatchObject({
            title: 'タスクの期限が近づいています',
            options: { tag: 'task-deadline-task-fallback' },
        });
        expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['task-fallback']);
    });

    it('習慣通知の配信失敗時は通知日を記録しない', async () => {
        vi.setSystemTime(new Date('2026-06-13T11:00:00.000Z'));
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                getRegistration: vi.fn().mockResolvedValue({
                    showNotification: vi.fn().mockRejectedValue(new Error('delivery failed')),
                }),
            },
        });
        useHabitStore.setState({
            habits: [{
                id: 'habit-1',
                name: '未完了の習慣',
                categoryId: 'other',
                createdAt: '2026-06-13T00:00:00.000Z',
            }],
            dailyRecords: [],
            restDays: [],
        });

        await runNotificationChecks();

        expect(useNotificationStore.getState().lastHabitReminderDate).toBeNull();
    });
});

describe('notification platform capability helpers', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('treats missing Notification API as unsupported and denies permission requests', async () => {
        vi.stubGlobal('Notification', undefined);

        expect(isNotificationSupported()).toBe(false);
        expect(getNotificationPermission()).toBe('unsupported');
        await expect(requestNotificationPermission()).resolves.toBe('denied');
    });

    it('normalizes permission API failures to denied/unsupported values', async () => {
        vi.stubGlobal('Notification', class BrokenNotification {
            static get permission() {
                throw new Error('permission unavailable');
            }
            static requestPermission = vi.fn().mockRejectedValue(new Error('prompt failed'));
        });

        expect(getNotificationPermission()).toBe('unsupported');
        await expect(requestNotificationPermission()).resolves.toBe('denied');
    });
});

describe('resolveHabitReminderHour', () => {
    it('keeps valid reminder hours in range', () => {
        expect(resolveHabitReminderHour(0)).toBe(0);
        expect(resolveHabitReminderHour(8)).toBe(8);
        expect(resolveHabitReminderHour(23)).toBe(23);
    });

    it('floors fractional hours and clamps out-of-range hours', () => {
        expect(resolveHabitReminderHour(7.9)).toBe(7);
        expect(resolveHabitReminderHour(-5)).toBe(0);
        expect(resolveHabitReminderHour(30)).toBe(23);
    });

    it('falls back to the configured default for non-finite values', () => {
        expect(resolveHabitReminderHour(Number.NaN)).toBe(NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST);
        expect(resolveHabitReminderHour(Number.POSITIVE_INFINITY)).toBe(NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST);
        expect(resolveHabitReminderHour(undefined)).toBe(NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST);
    });
});
