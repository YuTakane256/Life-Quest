import { expect, test, type Page } from '@playwright/test';

const modulePath = '/e2e/fixtures/battle-recovery.ts';
const harnessPath = '/battle-recovery-test-harness';
const owner = 'disposable-owner-for-battle-recovery';
type Fixture = typeof import('./fixtures/battle-recovery');
type ReleaseSlot = Window & { releaseBattleRecoveryTest?: () => void };

async function loadOwner(page: Page) {
    await page.goto(harnessPath);
    await page.evaluate(async ({ modulePath, owner }) => {
        const { notifyLogin, battleResultRecovery }: Fixture = await import(modulePath);
        await notifyLogin(owner);
        await battleResultRecovery.load();
    }, { modulePath, owner });
}

test('battle start, result recovery and account retirement coordinate across browser tabs', async ({ context, page }) => {
    await context.route('**' + harnessPath, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local battle test</title>' }));
    await loadOwner(page);
    expect(await page.evaluate(async ({ modulePath, owner }) => {
        const { tryAcquireWebBattleSession, battleResultRecovery }: Fixture = await import(modulePath);
        const lease = await tryAcquireWebBattleSession(owner);
        if (!lease) return false;
        await battleResultRecovery.prepare(owner, { attemptId: 'attempt', key: 'retry-key', actions: [{ type: 'attack' }] });
        return true; // The browser releases this battle lease when the first tab closes.
    }, { modulePath, owner })).toBe(true);

    const second = await context.newPage();
    await loadOwner(second);
    expect(await second.evaluate(async ({ modulePath, owner }) => {
        const { battleResultRecovery, tryAcquireWebBattleSession, withWebBattleRecoverySession }: Fixture = await import(modulePath);
        const snapshot = battleResultRecovery.getState();
        const available = await tryAcquireWebBattleSession(owner);
        available?.();
        const recovery = await withWebBattleRecoverySession(snapshot, () => battleResultRecovery.discard(snapshot));
        const otherOwner = await tryAcquireWebBattleSession('another-disposable-owner');
        otherOwner?.();
        return { pending: snapshot.pending?.attemptId, startAllowed: Boolean(available), recovery, otherOwner: Boolean(otherOwner) };
    }, { modulePath, owner })).toEqual({ pending: 'attempt', startAllowed: false, recovery: false, otherOwner: true });

    await page.close();
    const recovery = second.evaluate(async (modulePath) => {
        const { battleResultRecovery, withWebBattleRecoverySession }: Fixture = await import(modulePath);
        return withWebBattleRecoverySession(battleResultRecovery.getState(), () =>
            new Promise<void>((release) => { (window as ReleaseSlot).releaseBattleRecoveryTest = release; }));
    }, modulePath);
    await second.waitForFunction(() => Boolean((window as ReleaseSlot).releaseBattleRecoveryTest));
    const third = await context.newPage();
    await loadOwner(third);
    expect(await third.evaluate(async (modulePath) => {
        const { battleResultRecovery, withWebBattleRecoverySession }: Fixture = await import(modulePath);
        const snapshot = battleResultRecovery.getState();
        return withWebBattleRecoverySession(snapshot, () => battleResultRecovery.discard(snapshot));
    }, modulePath)).toBe(false);
    await second.evaluate(async ({ modulePath, owner }) => {
        const { battleResultRecovery, captureAuthSessionScope, applyPullBatchToCache, createEmptyCloudCache }: Fixture = await import(modulePath);
        await battleResultRecovery.reconcile(applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 7, has_more: false,
            battle_attempts: [{ id: 'attempt', user_id: owner, status: 'resolved', outcome: 'victory', version: 7 }],
        }), captureAuthSessionScope());
    }, { modulePath, owner });
    expect(await third.evaluate(async ({ modulePath, owner }) => {
        const { tryAcquireWebBattleSession }: Fixture = await import(modulePath);
        const lease = await tryAcquireWebBattleSession(owner);
        lease?.();
        return Boolean(lease);
    }, { modulePath, owner })).toBe(true);
    await second.evaluate(() => (window as ReleaseSlot).releaseBattleRecoveryTest?.());
    await expect(recovery).resolves.toBe(true);

    await third.evaluate(async ({ modulePath, owner }) => {
        const { battleResultRecovery, retireWebBattleResultRecovery }: Fixture = await import(modulePath);
        await battleResultRecovery.prepare(owner, { attemptId: 'next', key: 'next-key', actions: [{ type: 'attack' }] });
        await retireWebBattleResultRecovery(owner);
    }, { modulePath, owner });
    expect(await second.evaluate(async ({ modulePath, owner }) => {
        const { battleResultRecovery, battleResultRecoveryKey }: Fixture = await import(modulePath);
        let wrote = false;
        try {
            await battleResultRecovery.prepare(owner, { attemptId: 'late', key: 'late-key', actions: [{ type: 'attack' }] });
            wrote = true;
        } catch { /* A stale session must not recreate a deleted owner's result. */ }
        return { wrote, persisted: localStorage.getItem(battleResultRecoveryKey(owner)), rawOwnerInKey: Object.keys(localStorage).some((key) => key.includes(owner)) };
    }, { modulePath, owner })).toEqual({ wrote: false, persisted: null, rawOwnerInKey: false });
});
