import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const DEFAULT_FALLBACK_PATH = '/tasks';

function hasControlCharacter(value: string): boolean {
    return Array.from(value).some((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || code === 127;
    });
}

export function normalizeFallbackPath(path: unknown): string {
    if (typeof path !== 'string') return DEFAULT_FALLBACK_PATH;

    const trimmed = path.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_FALLBACK_PATH;
    if (trimmed.includes('\\') || hasControlCharacter(trimmed)) return DEFAULT_FALLBACK_PATH;

    return trimmed;
}

export function useBackWithFallback(fallbackPath = '/tasks') {
    const navigate = useNavigate();
    const location = useLocation();

    return useCallback(() => {
        if (location.key === 'default') {
            navigate(normalizeFallbackPath(fallbackPath), { replace: true });
            return;
        }
        navigate(-1);
    }, [fallbackPath, location.key, navigate]);
}
