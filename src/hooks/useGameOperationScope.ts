import { useEffect, useRef } from 'react';
import { captureAuthSessionScope, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';

/** resetはref/安定したstate setterだけを参照する。認証切替時にretry情報も破棄する。 */
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
