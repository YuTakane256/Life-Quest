import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from './authLifecycle.ts';
import { createGameCloudClient } from './gameCloud.ts';
import { createEdgeFunctionInvoker, type EdgeFunctionInvoker } from './edgeFunctions.ts';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
const routes = ['chest', 'synthesis', 'battle-start', 'battle-resolve'] as const;
afterEach(() => resetAuthLifecycleHooks());
describe.each(routes)('%sの送信セッション境界', (route) => {
    function request(client: ReturnType<typeof createGameCloudClient>) {
        if (route === 'battle-start') return client.startBattleAttempt(1, 'same-key', 'a');
        if (route === 'battle-resolve') return client.resolveBattleAttempt('attempt', [{ type: 'attack' }],
            { isActive: () => true, expectedUserId: 'a', idempotencyKey: 'same-key' });
        return route === 'chest' ? client.openChest('chest-a', 'same-key')
            : client.synthesizeItems(['one', 'two', 'three'], 'same-key');
    }
    it('送信先取得待ちで切り替えたら送らない', async () => {
        await notifyLogin('a');
        const ready = deferred<EdgeFunctionInvoker>();
        const called = vi.fn();
        const invoker: EdgeFunctionInvoker = async <T>() => { called(); return {} as T; };
        const client = createGameCloudClient({ getInvoker: () => ready.promise });
        const result = request(client);
        await notifyLogin('b');
        ready.resolve(invoker);
        await expect(result).rejects.toMatchObject({ code: 'stale-session' });
        expect(called).not.toHaveBeenCalled();
    });
    it('A→logout→Aでも古い応答を返さない', async () => {
        await notifyLogin('a');
        const response = deferred<unknown>();
        const invoked = deferred<void>();
        const invoker: EdgeFunctionInvoker = async <T>() => { invoked.resolve(); return await response.promise as T; };
        const client = createGameCloudClient({ getInvoker: () => invoker });
        const result = request(client);
        await invoked.promise;
        await notifyLogout(); await notifyLogin('a');
        response.resolve({ item_id: 'a-item', template_id: 'wooden_sword', result_id: 'a-item' });
        await expect(result).rejects.toMatchObject({ code: 'stale-session' });
    });
    it('SDKが別所有者のJWTを返しても送信しない', async () => {
        await notifyLogin('a');
        const fetchFn = vi.fn<typeof fetch>();
        const client = createGameCloudClient({ getInvoker: () => createEdgeFunctionInvoker({
            functionsUrl: 'https://example.test', anonKey: 'anon', fetchFn,
            getSession: async () => ({ accessToken: 'b-token', userId: 'b' }), refreshSession: async () => null,
        }) });
        await expect(request(client)).rejects.toMatchObject({ code: 'stale-session' });
        expect(fetchFn).not.toHaveBeenCalled();
    });
    it('401更新で別所有者のJWTに変わったら、そのJWTで再送しない', async () => {
        await notifyLogin('a');
        const fetchFn = vi.fn<typeof fetch>(async () => new Response('', { status: 401 }));
        const client = createGameCloudClient({ getInvoker: () => createEdgeFunctionInvoker({
            functionsUrl: 'https://example.test', anonKey: 'anon', fetchFn,
            getSession: async () => ({ accessToken: 'a-token', userId: 'a' }),
            refreshSession: async () => ({ accessToken: 'b-token', userId: 'b' }),
        }) });
        await expect(request(client)).rejects.toMatchObject({ code: 'stale-session' });
        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [, options] = fetchFn.mock.calls[0];
        expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer a-token');
        expect(JSON.parse(options!.body as string).idempotencyKey).toBe('same-key');
    });
});

it('決着の行動オブジェクトと列をコピーし、呼び出し元の変更を送信へ混入させない', async () => {
    const ready = deferred<EdgeFunctionInvoker>();
    const calls: unknown[] = [];
    const client = createGameCloudClient({ getInvoker: () => ready.promise });
    const action = { type: 'skill' as const, skillId: 'original' };
    const actions = [action];
    const result = client.resolveBattleAttempt('attempt', actions, { isActive: () => true, idempotencyKey: 'same-key' });
    action.skillId = 'different'; actions.push(action);
    ready.resolve(async <T>(_name: string, body?: Record<string, unknown>) => {
        calls.push(body); return { outcome: 'victory', granted: true } as T;
    });
    await result;
    expect(calls).toEqual([{ battleAttemptId: 'attempt', actions: [{ type: 'skill', skillId: 'original' }], idempotencyKey: 'same-key' }]);
});

it('合成対象は送信先取得待ちの前にコピーし、呼び出し元の配列変更を混入させない', async () => {
    const ready = deferred<EdgeFunctionInvoker>();
    const calls: unknown[] = [];
    const client = createGameCloudClient({ getInvoker: () => ready.promise });
    const ids = ['one', 'two', 'three'];
    const result = client.synthesizeItems(ids, 'same-key');
    ids.push('different');
    ready.resolve(async <T>(_name: string, body?: Record<string, unknown>) => {
        calls.push(body);
        return { result_id: 'result', template_id: 'wooden_sword' } as T;
    });
    await result;
    expect(calls).toEqual([{ itemIds: ['one', 'two', 'three'], idempotencyKey: 'same-key' }]);
});
