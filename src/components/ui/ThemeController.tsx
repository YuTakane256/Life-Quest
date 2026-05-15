import { useEffect } from 'react';
import { useThemeStore } from '../../stores/useThemeStore';

function resolveSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeController() {
    const mode = useThemeStore((state) => state.mode);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');

        const applyTheme = () => {
            const resolvedTheme = mode === 'system' ? resolveSystemTheme() : mode;
            document.documentElement.dataset.theme = resolvedTheme;
            document.documentElement.dataset.themeMode = mode;
            document.documentElement.style.colorScheme = resolvedTheme;
        };

        applyTheme();
        if (mode !== 'system') return;

        mediaQuery.addEventListener('change', applyTheme);
        return () => mediaQuery.removeEventListener('change', applyTheme);
    }, [mode]);

    return null;
}
