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
