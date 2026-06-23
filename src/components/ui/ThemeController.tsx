import { useEffect } from 'react';
import { useMotionStore } from '../../stores/useMotionStore';
import { useThemeStore } from '../../stores/useThemeStore';

type ResolvedTheme = 'light' | 'dark';
type ResolvedMotion = 'standard' | 'reduced';

function resolveSystemTheme(): ResolvedTheme {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolveSystemMotion(): ResolvedMotion {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'standard';
}

export function ThemeController() {
    const themeMode = useThemeStore((state) => state.mode);
    const motionMode = useMotionStore((state) => state.mode);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');

        const applyTheme = () => {
            // 防御の二重化: store 側で sanitize 済みだが、ここでも mode を厳密に判定して
            // DOM 属性に invalid 値が漏れないようにする
            const resolvedTheme: ResolvedTheme =
                themeMode === 'light' ? 'light'
                    : themeMode === 'dark' ? 'dark'
                        : resolveSystemTheme();
            const safeMode: 'light' | 'dark' | 'system' =
                themeMode === 'light' || themeMode === 'dark' || themeMode === 'system' ? themeMode : 'system';
            document.documentElement.dataset.theme = resolvedTheme;
            document.documentElement.dataset.themeMode = safeMode;
            document.documentElement.style.colorScheme = resolvedTheme;
        };

        applyTheme();
        if (themeMode !== 'system') return;

        mediaQuery.addEventListener('change', applyTheme);
        return () => mediaQuery.removeEventListener('change', applyTheme);
    }, [themeMode]);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

        const applyMotion = () => {
            const resolvedMotion: ResolvedMotion =
                motionMode === 'reduced' ? 'reduced'
                    : motionMode === 'standard' ? 'standard'
                        : resolveSystemMotion();
            const safeMode =
                motionMode === 'system' || motionMode === 'standard' || motionMode === 'reduced' ? motionMode : 'system';
            document.documentElement.dataset.motion = resolvedMotion;
            document.documentElement.dataset.motionMode = safeMode;
        };

        applyMotion();
        if (motionMode !== 'system') return;

        mediaQuery.addEventListener('change', applyMotion);
        return () => mediaQuery.removeEventListener('change', applyMotion);
    }, [motionMode]);

    return null;
}
