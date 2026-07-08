import { describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME } from '@life-quest/core/designTokens';
import { getMobileThemePalette, resolveMobileThemeMode, theme } from './colors';

describe('mobile theme', () => {
    it('coreのダークテーマトークンをそのまま使う（Web準拠）', () => {
        expect(theme).toBe(DARK_THEME);
    });

    it('全トークンが有効なhexカラーである', () => {
        const hexPattern = /^#[0-9a-f]{6}$/;
        const flat = [
            ...Object.values(theme.bg),
            ...Object.values(theme.accent),
            ...Object.values(theme.text),
            ...Object.values(theme.border),
            ...Object.values(theme.priority),
            theme.chest.blue, theme.chest.wood, theme.chest.silver, theme.chest.gold, theme.chest.redGold,
            ...theme.chest.rainbowStops,
            ...Object.values(theme.rarity),
        ];
        for (const value of flat) {
            expect(value).toMatch(hexPattern);
        }
    });

    it('設定とシステム設定から表示テーマを解決する', () => {
        expect(resolveMobileThemeMode('light', 'dark')).toBe('light');
        expect(resolveMobileThemeMode('dark', 'light')).toBe('dark');
        expect(resolveMobileThemeMode('system', 'light')).toBe('light');
        expect(resolveMobileThemeMode('system', 'dark')).toBe('dark');
        expect(resolveMobileThemeMode('system', null)).toBe('dark');
    });

    it('解決済みテーマに対応する共通トークンを返す', () => {
        expect(getMobileThemePalette('light')).toBe(LIGHT_THEME);
        expect(getMobileThemePalette('dark')).toBe(DARK_THEME);
    });
});
