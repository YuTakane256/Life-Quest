import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { captureAuthSessionScope, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';

/** Native counterpart: a retained tab loses confirmation ownership on blur too. */
export function useInventoryInteractionScope(reset: () => void) {
    const owner = useRef({ active: false, generation: 0, timers: new Set<ReturnType<typeof setTimeout>>() });
    const resetRef = useRef(reset);
    const [, refresh] = useState(0);
    const renderedScope = captureAuthSessionScope();
    const invalidate = useCallback(() => {
        const state = owner.current;
        state.generation++;
        for (const timer of state.timers) clearTimeout(timer);
        state.timers.clear();
    }, []);
    useFocusEffect(useCallback(() => {
        owner.current.active = true;
        return () => { owner.current.active = false; invalidate(); resetRef.current(); };
    }, [invalidate]));
    useEffect(() => {
        const unsubscribe = subscribeAuthSessionScope(() => { invalidate(); resetRef.current(); refresh((value) => value + 1); });
        return () => { invalidate(); unsubscribe(); };
    }, [invalidate]);
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
