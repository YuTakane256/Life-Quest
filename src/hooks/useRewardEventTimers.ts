import { useCallback, useEffect, useMemo, useState } from 'react';
import { captureAuthSessionScope, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';

/** Presentation-only timers belong to one event instance, mount and auth scope.
 * Read the store again at execution time: replacement may precede React's cleanup.
 * getCurrentEvent must be stable and return the stored object, not a copy/ID.
 */
export function useRewardEventTimers<T extends object>(event: T | null, getCurrentEvent: () => T | null) {
    const owner = useMemo(() => ({
        event,
        scope: captureAuthSessionScope(),
        mounted: false,
        timers: new Set<number>(),
    }), [event]);
    const [invalidatedOwner, setInvalidatedOwner] = useState<object | null>(null);

    useEffect(() => {
        owner.mounted = true;
        const cancelAll = () => {
            for (const timer of owner.timers) window.clearTimeout(timer);
            owner.timers.clear();
        };
        const unsubscribe = subscribeAuthSessionScope(() => {
            cancelAll();
            // Hide stale presentation even while an earlier async auth hook delays store cleanup.
            setInvalidatedOwner(owner);
        });
        // A transition between render and subscription must not leave the old modal visible.
        if (!owner.scope.isCurrent()) setInvalidatedOwner(owner);
        return () => {
            owner.mounted = false;
            cancelAll();
            unsubscribe();
        };
    }, [owner]);

    const isCurrent = useCallback(() => Boolean(
        owner.mounted && owner.event && owner.scope.isCurrent() && getCurrentEvent() === owner.event
    ), [owner, getCurrentEvent]);

    const schedule = useCallback((callback: () => void, delay: number): (() => void) => {
        if (!isCurrent()) return () => {};
        const timer = window.setTimeout(() => {
            owner.timers.delete(timer);
            if (isCurrent()) callback();
        }, delay);
        owner.timers.add(timer);
        return () => {
            window.clearTimeout(timer);
            owner.timers.delete(timer);
        };
    }, [owner, isCurrent]);

    return {
        schedule,
        isCurrent,
        active: Boolean(event && invalidatedOwner !== owner && owner.scope.isCurrent()),
    };
}
