import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function useBackWithFallback(fallbackPath = '/tasks') {
    const navigate = useNavigate();
    const location = useLocation();

    return useCallback(() => {
        if (location.key === 'default') {
            navigate(fallbackPath, { replace: true });
            return;
        }
        navigate(-1);
    }, [fallbackPath, location.key, navigate]);
}
