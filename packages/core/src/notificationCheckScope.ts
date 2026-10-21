import { captureAuthSessionGuard } from './authLifecycle.ts';

/** One check per live account/preference lifetime, not one global async lock. */
export function createNotificationCheckGate() {
    let active: { isCurrent: () => boolean; cancel: () => void } | null = null;
    return {
        cancel: () => active?.cancel(),
        begin(isAvailable: () => boolean, subscribe: (invalidate: () => void) => () => void) {
            if (!isAvailable() || active?.isCurrent()) return null;
            const sameSession = captureAuthSessionGuard();
            let valid = true;
            const owner = {
                isCurrent: () => valid && sameSession() && isAvailable(),
                cancel: () => { valid = false; },
            };
            active = owner;
            const unsubscribe = subscribe(owner.cancel);
            return {
                isCurrent: owner.isCurrent,
                finish: () => { owner.cancel(); unsubscribe(); if (active === owner) active = null; },
            };
        },
    };
}
