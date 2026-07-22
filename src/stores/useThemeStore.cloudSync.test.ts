import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore, type ThemeMode } from './useThemeStore';
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

describe('useThemeStore のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => vi.clearAllMocks());

    it('setMode時、upsert_user_settingsを他ストアの現在値も含めて集約しenqueueする', () => {
        useMotionStore.setState({ mode: 'reduced' });
        useNotificationStore.setState({ enabled: true, habitReminderHour: 21 });

        useThemeStore.getState().setMode('dark');

        expect(enqueueMock).toHaveBeenCalledWith('upsert_user_settings', {
            p_settings: { themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21 },
            p_base_version: null,
        });
    });

    it('不正な値はsystemへサニタイズしてからenqueueする', () => {
        useThemeStore.getState().setMode('bogus' as unknown as ThemeMode);

        expect(enqueueMock).toHaveBeenCalledWith('upsert_user_settings', expect.objectContaining({
            p_settings: expect.objectContaining({ themeMode: 'system' }),
        }));
    });
});
