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
    useThemeStore.setState({ mode: 'light' });
    useMotionStore.setState({ mode: 'system' });
    useNotificationStore.setState({ enabled: false, habitReminderHour: 20, notifiedTaskIds: [], lastHabitReminderDate: null });
}

describe('useMotionStore のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => vi.clearAllMocks());

    it('setMode時、upsert_user_settingsを他ストアの現在値も含めて集約しenqueueする', () => {
        useMotionStore.getState().setMode('reduced');

        expect(enqueueMock).toHaveBeenCalledWith('upsert_user_settings', {
            p_settings: { themeMode: 'light', motionMode: 'reduced', notificationsEnabled: false, habitReminderHour: 20 },
            p_base_version: null,
        });
    });
});
