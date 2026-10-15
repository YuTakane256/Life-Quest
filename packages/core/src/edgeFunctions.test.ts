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
    it.each(['b', undefined])('expectedUserIdがある時は異なる/不明のtoken所有者%sを拒否する', async (userId) => {
        const fetchFn = vi.fn();
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'anon',
            getSession: async () => ({ accessToken: 'token', userId }), refreshSession: async () => null, fetchFn });
        await expect(invoke('import_mobile_content', {}, { isActive: () => true, expectedUserId: 'a' }))
            .rejects.toMatchObject({ code: 'stale-session' });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('refreshが別ユーザーのtokenを返したら再送しない', async () => {
        const fetchFn = vi.fn(async () => jsonResponse(401, {}));
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'anon',
            getSession: async () => ({ accessToken: 'a-token', userId: 'a' }),
            refreshSession: async () => ({ accessToken: 'b-token', userId: 'b' }), fetchFn });
        await expect(invoke('import_mobile_content', {}, { isActive: () => true, expectedUserId: 'a' }))
            .rejects.toMatchObject({ code: 'stale-session' });
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('同一ユーザーのtoken更新は許可し、expectedUserIdもHTTP本文には含めない', async () => {
        const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse(401, {})).mockResolvedValueOnce(jsonResponse(200, {}));
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'anon',
            getSession: async () => ({ accessToken: 'a-token', userId: 'a' }),
            refreshSession: async () => ({ accessToken: 'new-a-token', userId: 'a' }), fetchFn });
        await invoke('import_mobile_content', { content: {} }, { isActive: () => true, expectedUserId: 'a' });
        expect(JSON.parse(fetchFn.mock.calls[1][1].body as string)).toEqual({ content: {} });
        expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer new-a-token');
    });

    it('無効な呼び出しスコープならトークン取得も通信も開始しない', async () => {
        const getSession = vi.fn(async () => ({ accessToken: 'token-a' }));
        const fetchFn = vi.fn();
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'anon',
            getSession, refreshSession: async () => null, fetchFn });
        await expect(invoke('import_snapshot', {}, { isActive: () => false })).rejects.toMatchObject({ code: 'stale-session' });
        expect(getSession).not.toHaveBeenCalled();
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('トークン取得中の失効で別セッションのトークンを送らない', async () => {
        let active = true;
        const fetchFn = vi.fn();
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'anon',
            getSession: async () => { active = false; return { accessToken: 'token-b' }; },
            refreshSession: async () => null, fetchFn });
        await expect(invoke('import_snapshot', {}, { isActive: () => active })).rejects.toMatchObject({ code: 'stale-session' });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('401到着時に失効していればrefreshも再送も開始しない', async () => {
        let active = true;
        const refreshSession = vi.fn(async () => ({ accessToken: 'token-b' }));
        const fetchFn = vi.fn(async () => { active = false; return jsonResponse(401, {}); });
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'anon',
            getSession: async () => ({ accessToken: 'token-a' }), refreshSession, fetchFn });
        await expect(invoke('import_snapshot', {}, { isActive: () => active })).rejects.toMatchObject({ code: 'stale-session' });
        expect(refreshSession).not.toHaveBeenCalled();
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('refresh待機中に失効したら新トークンでの再送をしない', async () => {
        let active = true;
        const fetchFn = vi.fn(async () => jsonResponse(401, {}));
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'anon',
            getSession: async () => ({ accessToken: 'token-a' }),
            refreshSession: async () => { active = false; return { accessToken: 'token-b' }; }, fetchFn });
        await expect(invoke('import_snapshot', {}, { isActive: () => active })).rejects.toMatchObject({ code: 'stale-session' });
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('ガードが有効なら既存の401再試行を維持し、オプションを本文へ含めない', async () => {
        const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse(401, {})).mockResolvedValueOnce(jsonResponse(200, { ok: true }));
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'anon',
            getSession: async () => ({ accessToken: 'token-a' }), refreshSession: async () => ({ accessToken: 'renewed-a' }), fetchFn });
        await expect(invoke('import_snapshot', { snapshot: {} }, { isActive: () => true })).resolves.toEqual({ ok: true });
        expect(fetchFn).toHaveBeenCalledTimes(2);
        const init = fetchFn.mock.calls[1][1] as RequestInit;
        expect(JSON.parse(init.body as string)).toEqual({ snapshot: {} });
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer renewed-a');
    });

    it('レスポンス本文の読み込み中に失効した成功結果は返さない', async () => {
        let active = true;
        const fetchFn = vi.fn(async () => ({ ok: true, status: 200,
            json: async () => { active = false; return { ok: true }; },
        } as unknown as Response));
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'anon',
            getSession: async () => ({ accessToken: 'token-a' }), refreshSession: async () => null, fetchFn });
        await expect(invoke('import_snapshot', {}, { isActive: () => active })).rejects.toMatchObject({ code: 'stale-session' });
    });

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
