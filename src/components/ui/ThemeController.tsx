import { useEffect } from 'react';
import { useThemeStore } from '../../stores/useThemeStore';

type ResolvedTheme = 'light' | 'dark';

function resolveSystemTheme(): ResolvedTheme {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeController() {
    const mode = useThemeStore((state) => state.mode);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');

        const applyTheme = () => {
            // 防御の二重化: store 側で sanitize 済みだが、ここでも mode を厳密に判定して
            // DOM 属性に invalid 値が漏れないようにする
            const resolvedTheme: ResolvedTheme =
                mode === 'light' ? 'light'
                    : mode === 'dark' ? 'dark'
                        : resolveSystemTheme();
            const safeMode: 'light' | 'dark' | 'system' =
                mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system';
            document.documentElement.dataset.theme = resolvedTheme;
            document.documentElement.dataset.themeMode = safeMode;
            document.documentElement.style.colorScheme = resolvedTheme;
        };

        applyTheme();
        if (mode !== 'system') return;

        mediaQuery.addEventListener('change', applyTheme);
        return () => mediaQuery.removeEventListener('change', applyTheme);
    }, [mode]);

    return null;
}
