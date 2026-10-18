import { useEffect, useRef, useState } from 'react';
import { captureAuthSessionScope, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';

/** Presentation/confirmation lifetime; does not change reward or network operations. */
export function useInteractionScope(reset: () => void) {
    const owner = useRef({ active: false, generation: 0, timers: new Set<ReturnType<typeof setTimeout>>() });
    const resetRef = useRef(reset);
    const [, refresh] = useState(0);
    const renderedScope = captureAuthSessionScope();
    useEffect(() => {
        const state = owner.current;
        state.active = true;
        const invalidate = () => {
            state.generation++;
            for (const timer of state.timers) clearTimeout(timer);
            state.timers.clear();
        };
        const unsubscribe = subscribeAuthSessionScope(() => { invalidate(); resetRef.current(); refresh((value) => value + 1); });
        return () => { state.active = false; invalidate(); unsubscribe(); };
    }, []);
    const capture = () => {
        const state = owner.current;
        const generation = state.generation;
        return () => state.active && state.generation === generation && renderedScope.isCurrent();
    };
    return {
        capture,
        schedule: (callback: () => void, delay: number) => {
            const isCurrent = capture();
            const state = owner.current;
            const timer = setTimeout(() => { state.timers.delete(timer); if (isCurrent()) callback(); }, delay);
            state.timers.add(timer);
        },
    };
}
