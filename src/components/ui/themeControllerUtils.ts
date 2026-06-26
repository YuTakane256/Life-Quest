export type ResolvedTheme = 'light' | 'dark';
export type ResolvedMotion = 'standard' | 'reduced';
export type SafeThemeMode = 'light' | 'dark' | 'system';
export type SafeMotionMode = 'system' | 'standard' | 'reduced';

export function getMediaQuery(query: string): MediaQueryList | null {
    if (typeof window.matchMedia !== 'function') return null;

    try {
        return window.matchMedia(query);
    } catch {
        return null;
    }
}

export function resolveSystemTheme(): ResolvedTheme {
    return getMediaQuery('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
}

export function resolveSystemMotion(): ResolvedMotion {
    return getMediaQuery('(prefers-reduced-motion: reduce)')?.matches ? 'reduced' : 'standard';
}

export function resolveThemeState(themeMode: unknown): { resolvedTheme: ResolvedTheme; safeMode: SafeThemeMode } {
    if (themeMode === 'light' || themeMode === 'dark') {
        return { resolvedTheme: themeMode, safeMode: themeMode };
    }

    return {
        resolvedTheme: resolveSystemTheme(),
        safeMode: 'system',
    };
}

export function resolveMotionState(motionMode: unknown): { resolvedMotion: ResolvedMotion; safeMode: SafeMotionMode } {
    if (motionMode === 'standard' || motionMode === 'reduced') {
        return { resolvedMotion: motionMode, safeMode: motionMode };
    }

    return {
        resolvedMotion: resolveSystemMotion(),
        safeMode: 'system',
    };
}
