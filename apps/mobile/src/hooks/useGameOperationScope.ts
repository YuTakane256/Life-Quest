import { useEffect, useRef } from 'react';
import { captureAuthSessionScope, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';

/** Webと同じ操作境界。React Nativeを共有coreへ持ち込まない薄いReact配線。 */
export function useGameOperationScope(reset: () => void) {
    const resetRef = useRef(reset);
    const mounted = useRef(true);
    const current = useRef<object | null>(null);
    useEffect(() => {
        mounted.current = true;
        const unsubscribe = subscribeAuthSessionScope(() => {
            current.current = null;
            resetRef.current();
        });
        return () => { mounted.current = false; current.current = null; unsubscribe(); };
    }, []);
    return {
        begin: () => {
            if (!mounted.current || current.current) return null;
            const scope = captureAuthSessionScope();
            const operation = {};
            current.current = operation;
            return {
                userId: scope.userId,
                isActive: () => mounted.current && current.current === operation && scope.isCurrent(),
                finish: () => { if (current.current === operation) current.current = null; },
            };
        },
    };
}
