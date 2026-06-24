import { useEffect } from 'react';
import { useMotionStore } from '../../stores/useMotionStore';
import { useThemeStore } from '../../stores/useThemeStore';
import { getMediaQuery, resolveMotionState, resolveThemeState } from './themeControllerUtils';

export function ThemeController() {
    const themeMode = useThemeStore((state) => state.mode);
    const motionMode = useMotionStore((state) => state.mode);

    useEffect(() => {
        const mediaQuery = getMediaQuery('(prefers-color-scheme: light)');

        const applyTheme = () => {
            const { resolvedTheme, safeMode } = resolveThemeState(themeMode);
            document.documentElement.dataset.theme = resolvedTheme;
            document.documentElement.dataset.themeMode = safeMode;
            document.documentElement.style.colorScheme = resolvedTheme;
        };

        applyTheme();
        if (themeMode !== 'system' || !mediaQuery) return;

        mediaQuery.addEventListener('change', applyTheme);
        return () => mediaQuery.removeEventListener('change', applyTheme);
    }, [themeMode]);

    useEffect(() => {
        const mediaQuery = getMediaQuery('(prefers-reduced-motion: reduce)');

        const applyMotion = () => {
            const { resolvedMotion, safeMode } = resolveMotionState(motionMode);
            document.documentElement.dataset.motion = resolvedMotion;
            document.documentElement.dataset.motionMode = safeMode;
        };

        applyMotion();
        if (motionMode !== 'system' || !mediaQuery) return;

        mediaQuery.addEventListener('change', applyMotion);
        return () => mediaQuery.removeEventListener('change', applyMotion);
    }, [motionMode]);

    return null;
}
