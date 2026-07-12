import { describe, expect, it, vi } from 'vitest';
import {
    clampReminderHour,
    sanitizeMobileMotionMode,
    sanitizeMobileThemeMode,
} from './useMobileSettingsStore';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(),
        removeItem: vi.fn(),
        setItem: vi.fn(),
    },
}));

describe('useMobileSettingsStore helpers', () => {
    it('テーマ設定を許可値へ丸める', () => {
        expect(sanitizeMobileThemeMode('light')).toBe('light');
        expect(sanitizeMobileThemeMode('dark')).toBe('dark');
        expect(sanitizeMobileThemeMode('system')).toBe('system');
        expect(sanitizeMobileThemeMode('neon')).toBe('system');
    });

    it('動きの量の設定を許可値へ丸める', () => {
        expect(sanitizeMobileMotionMode('standard')).toBe('standard');
        expect(sanitizeMobileMotionMode('reduced')).toBe('reduced');
        expect(sanitizeMobileMotionMode('system')).toBe('system');
        expect(sanitizeMobileMotionMode(null)).toBe('system');
    });

    it('通知時刻を0から23時の範囲へ丸める', () => {
        expect(clampReminderHour(-2)).toBe(0);
        expect(clampReminderHour(9.8)).toBe(9);
        expect(clampReminderHour(32)).toBe(23);
        expect(clampReminderHour('invalid')).toBe(20);
    });
});

describe('通知履歴（重複通知防止、Web useNotificationStoreのミラー）', () => {
    it('markTaskNotifiedはIDを重複なく記録し、上限200件で古い方から捨てる', async () => {
        const { useMobileSettingsStore } = await import('./useMobileSettingsStore');
        useMobileSettingsStore.setState({ notifiedTaskIds: [] });

        useMobileSettingsStore.getState().markTaskNotified('task-1');
        useMobileSettingsStore.getState().markTaskNotified('task-1');
        expect(useMobileSettingsStore.getState().notifiedTaskIds).toEqual(['task-1']);

        for (let i = 0; i < 250; i++) {
            useMobileSettingsStore.getState().markTaskNotified(`bulk-${i}`);
        }
        const ids = useMobileSettingsStore.getState().notifiedTaskIds;
        expect(ids).toHaveLength(200);
        expect(ids).not.toContain('task-1'); // 古い方から追い出される
        expect(ids).toContain('bulk-249');
    });

    it('pruneNotifiedTasksは現存するタスクのIDだけを残す', async () => {
        const { useMobileSettingsStore } = await import('./useMobileSettingsStore');
        useMobileSettingsStore.setState({ notifiedTaskIds: ['keep', 'gone'] });
        useMobileSettingsStore.getState().pruneNotifiedTasks(['keep']);
        expect(useMobileSettingsStore.getState().notifiedTaskIds).toEqual(['keep']);
    });

    it('markHabitRemindedはYYYY-MM-DDのみ受け付ける', async () => {
        const { useMobileSettingsStore } = await import('./useMobileSettingsStore');
        useMobileSettingsStore.setState({ lastHabitReminderDate: null });
        useMobileSettingsStore.getState().markHabitReminded('not-a-date');
        expect(useMobileSettingsStore.getState().lastHabitReminderDate).toBeNull();
        useMobileSettingsStore.getState().markHabitReminded('2026-07-13');
        expect(useMobileSettingsStore.getState().lastHabitReminderDate).toBe('2026-07-13');
    });
});
