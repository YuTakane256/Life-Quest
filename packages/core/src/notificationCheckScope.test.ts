import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { notifyLogin, resetAuthLifecycleHooks } from './authLifecycle.ts';
import { createNotificationCheckGate } from './notificationCheckScope.ts';
beforeEach(async () => { resetAuthLifecycleHooks(); await notifyLogin('a'); });
afterEach(resetAuthLifecycleHooks);
describe('notification check ownership', () => {
    it('deduplicates only a current check and invalidates completed work', () => {
        const gate = createNotificationCheckGate(); const start = () => gate.begin(() => true, () => () => {});
        const first = start()!; expect(first.isCurrent()).toBe(true); expect(start()).toBeNull(); first.finish(); expect(first.isCurrent()).toBe(false);
        expect(start()).not.toBeNull();
    });
    it('allows a new account before the old promise completes without losing its lock', async () => {
        const gate = createNotificationCheckGate(); const start = () => gate.begin(() => true, () => () => {});
        const old = start()!; await notifyLogin('b'); const current = start()!; expect(old.isCurrent()).toBe(false);
        old.finish(); expect(current.isCurrent()).toBe(true); expect(start()).toBeNull(); current.finish();
    });
    it('preserves same-user notifications', async () => {
        const gate = createNotificationCheckGate(); const check = gate.begin(() => true, () => () => {})!;
        await notifyLogin('a'); expect(check.isCurrent()).toBe(true); check.finish();
    });
    it('does not revive a check after an OFF→ON round trip', () => {
        const gate = createNotificationCheckGate(); let invalidate = () => {};
        const old = gate.begin(() => true, (cancel) => { invalidate = cancel; return () => {}; })!;
        invalidate(); expect(old.isCurrent()).toBe(false); const current = gate.begin(() => true, () => () => {})!;
        old.finish(); expect(current.isCurrent()).toBe(true); current.finish();
    });
    it('cancellation releases stale work, not the next owner', () => {
        const gate = createNotificationCheckGate(); const start = () => gate.begin(() => true, () => () => {});
        const old = start()!; gate.cancel(); const current = start()!; old.finish(); expect(start()).toBeNull(); current.finish();
    });
    it('does not start when unavailable and cleans up its subscription', () => {
        const gate = createNotificationCheckGate(); let count = 0;
        const subscribe = () => { count++; return () => { count--; }; };
        expect(gate.begin(() => false, subscribe)).toBeNull(); expect(count).toBe(0);
        const check = gate.begin(() => true, subscribe)!; expect(count).toBe(1); check.finish(); expect(count).toBe(0);
    });
});
