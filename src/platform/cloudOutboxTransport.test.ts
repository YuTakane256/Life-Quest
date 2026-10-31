import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createAccountBoundOutboxRpcClient } from '@life-quest/core/cloudOutboxController';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';

const mock = vi.hoisted(() => ({ user: 'a', token: 'a-token', status: 200, headers: [] as string[] }));
vi.mock('./supabase', () => ({ getWebSupabaseClient: () => ({
    auth: { getSession: async () => ({ data: { session: {
        user: { id: mock.user }, access_token: mock.token,
    } }, error: null }) },
    rpc: () => ({ setHeader: async (name: string, value: string) => {
        expect(name).toBe('Authorization');
        mock.headers.push(value);
        return { status: mock.status, error: mock.status === 401 ? { message: 'expired', code: 'PGRST301' } : mock.status >= 400 ? { message: 'private-rpc-detail', code: String(mock.status) } : null };
    } }),
}) }));
vi.mock('./edgeFunctions', () => ({ getWebEdgeFunctionInvoker: () => null }));
import { registerWebOutboxHooks, enqueueCloudOperation, getActiveWebOutbox, retryPendingOutbox } from './cloudOutbox';

afterEach(() => { resetAuthLifecycleHooks(); localStorage.clear(); mock.headers.length = 0; mock.user = 'a'; mock.token = 'a-token'; mock.status = 200; });

describe('Web RPC wiring', () => {
    it('SDKがBへ先に切り替わっていたらAのキューを送らず、Aで認証回復したときだけ同じIDで再送する', async () => {
        const unregister = registerWebOutboxHooks();
        await notifyLogin('a');
        mock.user = 'b'; mock.token = 'b-token';
        await enqueueCloudOperation('upsert_task', { p_id: 'task-a' });
        const outbox = getActiveWebOutbox()!;
        await outbox.flush();
        const id = outbox.snapshot()[0].opId;
        expect(outbox.snapshot()[0].failure?.kind).toBe('auth-required');
        expect(mock.headers).toEqual([]);
        mock.user = 'a'; mock.token = 'a-new-token';
        await retryPendingOutbox();
        expect(mock.headers).toEqual([]); // 手動再送だけでは401停止を解除しない
        expect(outbox.snapshot()[0].opId).toBe(id);
        await notifyLogin('a');
        expect(mock.headers).toEqual(['Bearer a-new-token']);
        expect(outbox.snapshot()).toEqual([]);
        await notifyLogout();
        unregister();
    });

    it('SDKのPostgRESTエラーもHTTP401なら認証回復待ちとなる', async () => {
        const unregister = registerWebOutboxHooks();
        await notifyLogin('a');
        mock.status = 401;
        await enqueueCloudOperation('delete_task', { p_id: 'task' });
        const outbox = getActiveWebOutbox()!;
        await outbox.flush();
        expect(outbox.snapshot()[0].failure?.kind).toBe('auth-required');
        await retryPendingOutbox();
        expect(mock.headers).toEqual(['Bearer a-token']);
        await notifyLogout();
        unregister();
    });
});

it('実際のSupabase SDKが後からBのtokenを取得しても、明示したAのAuthorizationを上書きしない', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('null', { status: 200 }));
    const sdk = createClient('https://example.supabase.co', 'anon', {
        accessToken: async () => 'b-sdk-token', global: { fetch: fetchFn },
    });
    const client = createAccountBoundOutboxRpcClient({
        getSession: async () => ({ session: { accessToken: 'a-captured-token', userId: 'a' } }),
        call: async (name, params, token) => {
            const { error, status } = await sdk.rpc(name, params).setHeader('Authorization', `Bearer ${token}`);
            return { error, status };
        },
    }, { expectedUserId: 'a', isActive: () => true });
    expect(await client.rpc('upsert_task', { p_key: 'same-id' })).toEqual({ error: null });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, options] = fetchFn.mock.calls[0];
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer a-captured-token');
    expect(JSON.parse(options!.body as string)).toEqual({ p_key: 'same-id' });

});

    it('恒久失敗の診断へ操作IDを出さず、キューのIDとpayloadを保持する', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const unregister = registerWebOutboxHooks();
        try {
            await notifyLogin('a'); mock.status = 403;
            await enqueueCloudOperation('delete_task', { p_id: 'private-row-id' });
            const outbox = getActiveWebOutbox()!; await outbox.flush();
            const [op] = outbox.snapshot();
            expect(op).toMatchObject({ status: 'failed', operation: 'delete_task', payload: { p_id: 'private-row-id' } });
            expect(warn).toHaveBeenCalledOnce();
            const log = JSON.stringify(warn.mock.calls);
            expect(log).not.toContain(op.opId); expect(log).not.toContain('private-row-id'); expect(log).not.toContain('private-rpc-detail');
            expect(warn.mock.calls[0][1]).toMatchObject({ event: 'outbox_permanent_failure', redacted: true });
        } finally { await notifyLogout(); unregister(); warn.mockRestore(); }
    });
