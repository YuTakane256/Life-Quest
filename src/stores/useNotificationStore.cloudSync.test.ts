import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from './useThemeStore';
import { useMotionStore } from './useMotionStore';
import { useNotificationStore } from './useNotificationStore';
import { enqueueCloudOperation } from '../platform/cloudOutbox';

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async () => true),
    isWebCloudOutboxActive: vi.fn(() => true),
}));

const enqueueMock = vi.mocked(enqueueCloudOperation);

function reset() {
    localStorage.clear();
    enqueueMock.mockClear();
    useThemeStore.setState({ mode: 'system' });
    useMotionStore.setState({ mode: 'system' });
    useNotificationStore.setState({ enabled: false, habitReminderHour: 20, notifiedTaskIds: [], lastHabitReminderDate: null });
}

describe('useNotificationStore のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => vi.clearAllMocks());

    it('setEnabled時、upsert_user_settingsをenqueueする', () => {
        useNotificationStore.getState().setEnabled(true);

        expect(enqueueMock).toHaveBeenCalledWith('upsert_user_settings', {
            p_settings: { themeMode: 'system', motionMode: 'system', notificationsEnabled: true, habitReminderHour: 20 },
            p_base_version: null,
        });
    });

    it('setHabitReminderHour時、upsert_user_settingsをenqueueする', () => {
        useNotificationStore.getState().setHabitReminderHour(9);

        expect(enqueueMock).toHaveBeenCalledWith('upsert_user_settings', expect.objectContaining({
            p_settings: expect.objectContaining({ habitReminderHour: 9 }),
        }));
    });

    it('markTaskNotified/markHabitReminded/pruneNotifiedTasksはenqueueしない（デバイスローカルの重複通知防止状態のため）', () => {
        useNotificationStore.getState().markTaskNotified('task-1');
        useNotificationStore.getState().markHabitReminded('2026-07-20');
        useNotificationStore.getState().pruneNotifiedTasks(['task-1']);

        expect(enqueueMock).not.toHaveBeenCalled();
    });
});
