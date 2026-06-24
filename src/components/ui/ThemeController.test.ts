import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    resolveMotionState,
    resolveSystemMotion,
    resolveSystemTheme,
    resolveThemeState,
} from './themeControllerUtils';

function stubMatchMedia(matchesByQuery: Record<string, boolean>) {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: matchesByQuery[query] ?? false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

describe('ThemeController helpers', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('falls back safely when matchMedia is unavailable', () => {
        vi.stubGlobal('matchMedia', undefined);

        expect(resolveSystemTheme()).toBe('dark');
        expect(resolveSystemMotion()).toBe('standard');
        expect(resolveThemeState('sepia')).toEqual({ resolvedTheme: 'dark', safeMode: 'system' });
        expect(resolveMotionState('off')).toEqual({ resolvedMotion: 'standard', safeMode: 'system' });
    });

    it('resolves system preferences from matchMedia when available', () => {
        stubMatchMedia({
            '(prefers-color-scheme: light)': true,
            '(prefers-reduced-motion: reduce)': true,
        });

        expect(resolveSystemTheme()).toBe('light');
        expect(resolveSystemMotion()).toBe('reduced');
        expect(resolveThemeState('system')).toEqual({ resolvedTheme: 'light', safeMode: 'system' });
        expect(resolveMotionState('system')).toEqual({ resolvedMotion: 'reduced', safeMode: 'system' });
    });

    it('keeps explicit modes without consulting system fallbacks', () => {
        stubMatchMedia({
            '(prefers-color-scheme: light)': true,
            '(prefers-reduced-motion: reduce)': true,
        });

        expect(resolveThemeState('dark')).toEqual({ resolvedTheme: 'dark', safeMode: 'dark' });
        expect(resolveMotionState('standard')).toEqual({ resolvedMotion: 'standard', safeMode: 'standard' });
    });
});
