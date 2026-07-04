/// <reference lib="dom" />
import { describe, expect, it, vi } from 'vitest';
import { createEdgeFunctionInvoker, EdgeFunctionError } from './edgeFunctions.ts';

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('createEdgeFunctionInvoker', () => {
    it('access_tokenをAuthorizationヘッダーへ付与して呼び出す', async () => {
        const fetchFn = vi.fn(async () => jsonResponse(200, { ok: true }));
        const invoke = createEdgeFunctionInvoker({
            functionsUrl: 'http://localhost:55321/functions/v1/',
            anonKey: 'anon-key',
            getSession: async () => ({ accessToken: 'token-1' }),
            refreshSession: async () => null,
            fetchFn,
        });

        const result = await invoke<{ ok: boolean }>('complete_task', { taskId: 't1' });

        expect(result).toEqual({ ok: true });
        const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('http://localhost:55321/functions/v1/complete_task');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
        expect((init.headers as Record<string, string>).apikey).toBe('anon-key');
    });

    it('未ログインならunauthenticatedで失敗する', async () => {
        const invoke = createEdgeFunctionInvoker({
            functionsUrl: 'http://x/functions/v1',
            anonKey: 'anon',
            getSession: async () => null,
            refreshSession: async () => null,
            fetchFn: vi.fn(),
        });

        await expect(invoke('complete_task')).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('401のときは1回だけリフレッシュして再試行する', async () => {
        const fetchFn = vi.fn()
            .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
            .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
        const refreshSession = vi.fn(async () => ({ accessToken: 'token-2' }));
        const invoke = createEdgeFunctionInvoker({
            functionsUrl: 'http://x/functions/v1',
            anonKey: 'anon',
            getSession: async () => ({ accessToken: 'token-1' }),
            refreshSession,
            fetchFn,
        });

        const result = await invoke<{ ok: boolean }>('complete_task');

        expect(result).toEqual({ ok: true });
        expect(refreshSession).toHaveBeenCalledTimes(1);
        const secondInit = (fetchFn.mock.calls as unknown as [string, RequestInit][])[1][1];
        expect((secondInit.headers as Record<string, string>).Authorization).toBe('Bearer token-2');
    });

    it('リフレッシュも失敗したらEdgeFunctionErrorになる', async () => {
        const fetchFn = vi.fn(async () => jsonResponse(401, { error: 'expired' }));
        const invoke = createEdgeFunctionInvoker({
            functionsUrl: 'http://x/functions/v1',
            anonKey: 'anon',
            getSession: async () => ({ accessToken: 'token-1' }),
            refreshSession: async () => null,
            fetchFn,
        });

        await expect(invoke('complete_task')).rejects.toBeInstanceOf(EdgeFunctionError);
        expect(fetchFn).toHaveBeenCalledTimes(1); // リフレッシュ失敗なら再試行しない
    });

    it('ボディに混入したuser_id/userIdは送信されない（ADR-007）', async () => {
        const fetchFn = vi.fn(async () => jsonResponse(200, {}));
        const invoke = createEdgeFunctionInvoker({
            functionsUrl: 'http://x/functions/v1',
            anonKey: 'anon',
            getSession: async () => ({ accessToken: 't' }),
            refreshSession: async () => null,
            fetchFn,
        });

        await invoke('complete_task', { taskId: 't1', user_id: 'attacker', userId: 'attacker' });

        const body = JSON.parse(((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]).body as string) as Record<string, unknown>;
        expect(body).toEqual({ taskId: 't1' });
    });
});
