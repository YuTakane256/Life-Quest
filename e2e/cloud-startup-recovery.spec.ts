import { expect, test } from '@playwright/test';

const owner = 'a1c97a74-0871-4103-875a-a31166e6a1c0';
const otherOwner = 'f2572156-1d4f-40d4-ac7b-51a25beed372';
const taskId = 'a71546a5-d139-4437-a3c7-4496e7ec00a4';
const otherTaskId = '4df84c98-f0ee-4760-a234-2bf3470617a4';
const opId = '78809fd1-e883-436a-ab0e-b02a37e8fa58';
const taskName = '通信復帰で受信したタスク';
const sessionKey = 'sb-127-auth-token';
const outboxKey = (userId: string) => `life-quest:cloud:${userId}:outbox:v1`;
const now = new Date('2026-11-14T01:00:00Z');

test.use({ serviceWorkers: 'block' });

test('Web cold start resumes its saved task after the SDK reconnects', async ({ page }) => {
    const user = { id: owner, aud: 'authenticated', email: 'startup-sync@example.invalid', app_metadata: {}, user_metadata: {} };
    const operation = { opId, operation: 'upsert_task', payload: { p_id: taskId, p_name: '送信待ちのタスク' },
        dependsOn: [], status: 'pending', enqueuedAt: now.toISOString(), baseVersion: null, optimisticSnapshot: null };
    const otherQueue = JSON.stringify({ ops: [{ ...operation, opId: 'other-operation', payload: { p_id: otherTaskId } }] });
    await page.clock.install({ time: now });
    await page.addInitScript(({ sessionKey, user, expiresAt, ownerKey, ownerQueue, otherKey, otherQueue }) => {
        localStorage.setItem(sessionKey, JSON.stringify({
            user, access_token: 'fixture-expired-access', refresh_token: 'fixture-old-refresh', expires_at: expiresAt,
        }));
        localStorage.setItem(ownerKey, ownerQueue);
        localStorage.setItem(otherKey, otherQueue);
    }, { sessionKey, user, expiresAt: now.getTime() / 1000 - 1, ownerKey: outboxKey(owner),
        ownerQueue: JSON.stringify({ ops: [operation] }), otherKey: outboxKey(otherOwner), otherQueue });
    await page.route((url) => url.pathname === '/src/platform/supabase.ts', (route) => route.fulfill({
        contentType: 'application/javascript',
        body: "export * from '/e2e/fixtures/startup-sync-supabase.ts';",
    }));
    await page.routeWebSocket((url) => url.pathname.startsWith('/__startup_sync/'), (socket) => socket.close());

    let connected = false;
    let refreshFailures = 0;
    let refreshSuccesses = 0;
    let upsertAcknowledged = false;
    let releaseUpsert!: () => void;
    const holdUpsert = new Promise<void>((resolve) => { releaseUpsert = resolve; });
    const calls: { method: string; bearer: string | undefined; payload: unknown }[] = [];
    const unexpected: string[] = [];
    await page.route((url) => url.pathname.startsWith('/__startup_sync/'), async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path.endsWith('/auth/v1/token')) {
            if (!connected) {
                refreshFailures += 1;
                if (refreshFailures === 1) {
                    // Jump past the SDK's initial retry window without firing its ticker.
                    await page.clock.setSystemTime(new Date(now.getTime() + 120_000));
                }
                await route.abort('internetdisconnected');
                return;
            }
            refreshSuccesses += 1;
            await route.fulfill({ json: {
                user, access_token: 'fixture-renewed-access', refresh_token: 'fixture-new-refresh',
                expires_in: 3600, token_type: 'bearer',
            } });
            return;
        }
        const method = path.split('/').at(-1) ?? '';
        if (path.includes('/rest/v1/')) {
            calls.push({ method, bearer: request.headers().authorization, payload: request.postDataJSON() });
        }
        switch (method) {
            case 'profiles':
                await route.fulfill({ json: { imported_at: now.toISOString() } });
                return;
            case 'upsert_task':
                await holdUpsert;
                upsertAcknowledged = true;
                await route.fulfill({ json: { id: taskId, version: 7 } });
                return;
            case 'claim_login_bonus':
                await route.fulfill({ json: {
                    granted: false, already_claimed: true, claim_date: '2026-11-14', streak: 1,
                    xp: 0, chest_label: null, version: 7,
                } });
                return;
            case 'pull_sync_batch':
                if (!upsertAcknowledged) {
                    unexpected.push('pull before upsert acknowledgment');
                    await route.fulfill({ json: { next_cursor: 0, has_more: false, tasks: [] } });
                    return;
                }
                await route.fulfill({ json: {
                    next_cursor: 7, has_more: false,
                    tasks: [{ id: taskId, name: taskName, version: 7, created_at: now.toISOString(),
                        due_date: null, tags: [], completed: false, priority: 'medium', recurrence: 'none', deleted_at: null }],
                } });
                return;
            default:
                unexpected.push(path);
                await route.abort();
        }
    });

    await page.goto('/tasks');
    const rewardState = () => page.evaluate(async () => {
        const path = '/e2e/fixtures/startup-sync-supabase.ts';
        const fixture: typeof import('./fixtures/startup-sync-supabase') = await import(path);
        return fixture.getGameRewardAuthorityState();
    });
    await expect.poll(rewardState).toBe('anonymous');
    expect(refreshFailures).toBeGreaterThan(0);
    expect(refreshSuccesses).toBe(0);
    expect(calls).toEqual([]);
    const savedOperations = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).ops, outboxKey(owner));
    expect(await savedOperations()).toMatchObject([{ opId, status: 'pending' }]);

    const receivedTask = page.getByText(taskName, { exact: true });
    try {
        connected = true;
        // Advance the SDK ticker after its retry cooldown. No auth callback is injected.
        await page.clock.fastForward(120_000);
        await expect.poll(() => calls.filter(({ method }) => method === 'upsert_task').length).toBe(1);
        expect(await savedOperations()).toMatchObject([{ opId, status: 'inflight' }]);
        await expect(receivedTask).toHaveCount(0);
        expect(calls.some(({ method }) => method === 'pull_sync_batch')).toBe(false);
    } finally { releaseUpsert(); }

    await expect(receivedTask).toBeVisible();
    await expect.poll(rewardState).toBe('authenticated');
    expect(refreshSuccesses).toBe(1);
    const relevantCalls = calls.filter(({ method }) => method === 'upsert_task' || method === 'pull_sync_batch');
    expect(relevantCalls[0]).toEqual({ method: 'upsert_task', bearer: 'Bearer fixture-renewed-access',
        payload: { ...operation.payload, p_key: opId } });
    expect(relevantCalls.filter(({ method }) => method === 'upsert_task')).toHaveLength(1);
    expect(relevantCalls[1]).toMatchObject({ method: 'pull_sync_batch', bearer: 'Bearer fixture-renewed-access',
        payload: { p_after_version: 0 } });
    expect(await savedOperations()).toEqual([]);
    expect(await page.evaluate((key) => localStorage.getItem(key), outboxKey(otherOwner))).toBe(otherQueue);
    expect(unexpected).toEqual([]);
});
