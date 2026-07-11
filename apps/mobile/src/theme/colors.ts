/**
 * Mobileのテーマ。Web `src/index.css` と同じ値を持つ core のデザイントークンを
 * 参照する（Webが製品上の正）。画面のStyleSheetはhexを直書きせず必ずここを通す。
 */
import { DARK_THEME, LIGHT_THEME, type ThemePalette } from '@life-quest/core/designTokens';
import type { MobileThemeMode } from '../stores/useMobileSettingsStore';

export type ResolvedMobileTheme = 'light' | 'dark';

export function resolveMobileThemeMode(
    mode: MobileThemeMode,
    systemScheme: 'light' | 'dark' | 'unspecified' | null | undefined,
): ResolvedMobileTheme {
    if (mode === 'light' || mode === 'dark') return mode;
    return systemScheme === 'light' ? 'light' : 'dark';
}

export function getMobileThemePalette(resolved: ResolvedMobileTheme): ThemePalette {
    return resolved === 'light' ? LIGHT_THEME : DARK_THEME;
}
