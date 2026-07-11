import { describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME } from '@life-quest/core/designTokens';
import { getMobileThemePalette, resolveMobileThemeMode } from './colors';

describe('mobile theme', () => {
    it('全トークンが有効なhexカラーである（ダーク/ライト双方）', () => {
        const hexPattern = /^#[0-9a-f]{6}$/;
        for (const palette of [DARK_THEME, LIGHT_THEME]) {
            const flat = [
                ...Object.values(palette.bg),
                ...Object.values(palette.accent),
                ...Object.values(palette.text),
                ...Object.values(palette.border),
                ...Object.values(palette.priority),
                palette.chest.blue, palette.chest.wood, palette.chest.silver, palette.chest.gold, palette.chest.redGold,
                ...palette.chest.rainbowStops,
                ...Object.values(palette.rarity),
            ];
            for (const value of flat) {
                expect(value).toMatch(hexPattern);
            }
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
