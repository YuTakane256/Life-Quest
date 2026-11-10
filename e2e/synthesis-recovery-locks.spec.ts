import { expect, test } from '@playwright/test';

type Fixture = typeof import('./fixtures/synthesis-recovery');
const path = '/synthesis-recovery-harness';
const modulePath = '/e2e/fixtures/synthesis-recovery.ts';
const owner = 'disposable-synthesis-owner';
const ingredients = ['first', 'second', 'third'];

test('the same browser shows one pending synthesis and prevents a competing send or discard', async ({ context, page }) => {
    await context.route('**' + path, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local synthesis test</title>' }));
    const other = await context.newPage();
    for (const tab of [page, other]) {
        await tab.goto(path);
        await tab.evaluate(async ({ modulePath, owner }) => {
            const { registerSynthesisRecovery, notifyLogin }: Fixture = await import(modulePath);
            registerSynthesisRecovery();
            await notifyLogin(owner);
        }, { modulePath, owner });
    }

    expect(await page.evaluate(async ({ modulePath, owner, ingredients }) => {
        const { tryAcquireSynthesisSend, synthesisRecovery }: Fixture = await import(modulePath);
        const acquired = await tryAcquireSynthesisSend(owner);
        if (!acquired) return false;
        const saved = await synthesisRecovery.prepare(owner, ingredients, () => 'original-key');
        return saved.fresh;
    }, { modulePath, owner, ingredients })).toBe(true);

    await expect.poll(() => other.evaluate(async (modulePath) => {
        const { synthesisRecovery }: Fixture = await import(modulePath);
        return synthesisRecovery.getState().pending?.key;
    }, modulePath)).toBe('original-key');
    expect(await other.evaluate(async ({ modulePath, owner }) => {
        const { tryAcquireSynthesisSend }: Fixture = await import(modulePath);
        const competing = await tryAcquireSynthesisSend(owner);
        competing?.();
        return Boolean(competing);
    }, { modulePath, owner })).toBe(false);

    await page.close();
    await expect.poll(() => other.evaluate(async ({ modulePath, owner }) => {
        const { tryAcquireSynthesisSend, synthesisRecovery, captureAuthSessionScope }: Fixture = await import(modulePath);
        const release = await tryAcquireSynthesisSend(owner);
        if (!release) return null;
        try {
            const pending = synthesisRecovery.getState().pending!;
            const recovered = await synthesisRecovery.prepare(owner, pending.itemIds, () => 'unexpected-key', pending);
            await synthesisRecovery.acknowledge(recovered.record, captureAuthSessionScope());
            return recovered;
        } finally { release(); }
    }, { modulePath, owner })).toEqual({
        fresh: false, record: { version: 1, userId: owner, key: 'original-key', itemIds: ingredients },
    });
});
