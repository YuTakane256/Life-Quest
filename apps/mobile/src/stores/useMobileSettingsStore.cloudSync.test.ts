/**
 * Mobile useMobileSettingsStoreのクラウド同期配線テスト。
 * Web `useThemeStore.cloudSync.test.ts`等のミラー。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => { memory.set(key, value); }),
        removeItem: vi.fn(async (key: string) => { memory.delete(key); }),
    },
}));

const enqueued: { operation: string; payload: Record<string, unknown> }[] = [];

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async (operation: string, payload: Record<string, unknown>) => {
        enqueued.push({ operation, payload });
        return true;
    }),
    isCloudOutboxActive: vi.fn(() => true),
}));

import { useMobileSettingsStore } from './useMobileSettingsStore';

function reset() {
    enqueued.length = 0;
    useMobileSettingsStore.setState({
        themeMode: 'system',
        motionMode: 'system',
        notificationsEnabled: false,
        habitReminderHour: 20,
        notifiedTaskIds: [],
        lastHabitReminderDate: null,
    });
}

describe('Mobile useMobileSettingsStore のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => vi.clearAllMocks());

    it('setThemeMode時、upsert_user_settingsを自ストアの現在値で集約しenqueueする', () => {
        useMobileSettingsStore.setState({ motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21 });

        useMobileSettingsStore.getState().setThemeMode('dark');

        expect(enqueued).toContainEqual({
            operation: 'upsert_user_settings',
            payload: {
                p_settings: { themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21 },
                p_base_version: null,
            },
        });
    });

    it('setMotionMode/setNotificationsEnabled/setHabitReminderHourもenqueueする', () => {
        useMobileSettingsStore.getState().setMotionMode('reduced');
        useMobileSettingsStore.getState().setNotificationsEnabled(true);
        useMobileSettingsStore.getState().setHabitReminderHour(9);

        expect(enqueued).toHaveLength(3);
        expect(enqueued.every((op) => op.operation === 'upsert_user_settings')).toBe(true);
    });

    it('markTaskNotified/markHabitReminded/pruneNotifiedTasksはenqueueしない（デバイスローカルの重複通知防止状態のため）', () => {
        useMobileSettingsStore.getState().markTaskNotified('task-1');
        useMobileSettingsStore.getState().markHabitReminded('2026-07-20');
        useMobileSettingsStore.getState().pruneNotifiedTasks(['task-1']);

        expect(enqueued).toHaveLength(0);
    });
});
