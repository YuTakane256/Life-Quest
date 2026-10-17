import { useCallback, useEffect, useRef, useState } from 'react';
import { captureAuthSessionGuard, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';
import { TASK_UNDO_DURATION_MS } from '@life-quest/core/tasks';

/** The message and its destructive callback share a mount, scope and deadline. */
export function useTaskUndoToast() {
    const [toast, setToast] = useState<{ message: string; onUndo: () => void } | null>(null);
    const current = useRef<object | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mounted = useRef(true);
    const clear = useCallback(() => {
        current.current = null;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
    }, []);
    useEffect(() => {
        mounted.current = true;
        const unsubscribe = subscribeAuthSessionScope(() => { clear(); setToast(null); });
        return () => { mounted.current = false; clear(); unsubscribe(); };
    }, [clear]);

    const showUndo = useCallback((message: string, onUndo: () => void) => {
        if (!mounted.current) return;
        clear();
        const token = {};
        const isCurrent = captureAuthSessionGuard();
        const expiresAt = Date.now() + TASK_UNDO_DURATION_MS;
        current.current = token;
        setToast({ message, onUndo: () => {
            if (!mounted.current || current.current !== token || !isCurrent() || Date.now() >= expiresAt) return;
            clear();
            setToast(null);
            onUndo();
        } });
        timer.current = setTimeout(() => {
            if (current.current !== token) return;
            clear();
            setToast(null);
        }, TASK_UNDO_DURATION_MS);
    }, [clear]);

    return { toast, showUndo };
}
