import { useCallback, useEffect, useMemo, useState } from 'react';
import { captureAuthSessionScope, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';

/** Native counterpart of Web's presentation-only event timers (no window dependency). */
export function useRewardEventTimers<T extends object>(event: T | null, getCurrentEvent: () => T | null) {
    const owner = useMemo(() => ({ event, scope: captureAuthSessionScope(), mounted: false,
        timers: new Set<ReturnType<typeof setTimeout>>() }), [event]);
    const [invalidatedOwner, setInvalidatedOwner] = useState<object | null>(null);
    useEffect(() => {
        owner.mounted = true;
        const cancelAll = () => { for (const timer of owner.timers) clearTimeout(timer); owner.timers.clear(); };
        const unsubscribe = subscribeAuthSessionScope(() => { cancelAll(); setInvalidatedOwner(owner); });
        if (!owner.scope.isCurrent()) setInvalidatedOwner(owner);
        return () => { owner.mounted = false; cancelAll(); unsubscribe(); };
    }, [owner]);
    const isCurrent = useCallback(() => Boolean(owner.mounted && owner.event && owner.scope.isCurrent()
        && getCurrentEvent() === owner.event), [owner, getCurrentEvent]);
    const schedule = useCallback((callback: () => void, delay: number) => {
        if (!isCurrent()) return () => {};
        const timer = setTimeout(() => { owner.timers.delete(timer); if (isCurrent()) callback(); }, delay);
        owner.timers.add(timer);
        return () => { clearTimeout(timer); owner.timers.delete(timer); };
    }, [owner, isCurrent]);
    return { schedule, isCurrent, active: Boolean(event && invalidatedOwner !== owner && owner.scope.isCurrent()) };
}
