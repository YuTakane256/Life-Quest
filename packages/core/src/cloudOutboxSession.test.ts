import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from './authLifecycle.ts';
import { cloudOutboxKey } from './cloudPull.ts';
import { createAccountBoundOutboxRpcClient, createCloudOutboxController } from './cloudOutboxController.ts';
import { createEdgeFunctionInvoker } from './edgeFunctions.ts';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}
function memory() {
    const map = new Map<string, string>();
    return { map, getItem: async (key: string) => map.get(key) ?? null,
        setItem: async (key: string, value: string) => { map.set(key, value); },
        removeItem: async (key: string) => { map.delete(key); } };
}
afterEach(() => resetAuthLifecycleHooks());

describe('outbox account boundary', () => {
    it('停止中の一時的な保存失敗でも、次のログインで復旧し元のopIdを再送する', async () => {
        const storage = memory();
        const failed = deferred();
        const entered = deferred();
        let writes = 0;
        const send = vi.fn(async () => ({ error: null }));
        const controller = createCloudOutboxController({ storage: { ...storage, setItem: async (key, value) => {
            if (++writes === 2) { entered.resolve(); await failed.promise; throw new Error('temporary disk error'); }
            await storage.setItem(key, value);
        } }, getRpcClient: () => ({ rpc: send }), getEdgeInvoker: () => null });
        const unregister = controller.registerHooks();
        await notifyLogin('a');
        await controller.enqueue('upsert_task', { p_id: 'keep-me' });
        const old = controller.getActiveOutbox()!;
        await entered.promise;
        const id = old.snapshot()[0].opId;
        const running = expect(old.flush()).rejects.toThrow('temporary disk error');
        const logout = notifyLogout();
        failed.resolve();
        await Promise.all([running, logout]);
        await notifyLogin('b');
        expect(controller.isActive()).toBe(true);
        await notifyLogin('a');
        const restored = controller.getActiveOutbox()!;
        expect(restored).not.toBe(old);
        await restored.flush();
        expect(send).toHaveBeenCalledExactlyOnceWith('upsert_task', { p_id: 'keep-me', p_key: id });
        expect(restored.snapshot()).toEqual([]);
        unregister();
    });
    it('保存待ちのA→B→Aでも、新Aはdetach済みAの保存完了を待って復元する', async () => {
        const storage = memory();
        const saved = deferred();
        const entered = deferred();
        let hold = true;
        const controller = createCloudOutboxController({ storage: { ...storage, setItem: async (key, value) => {
            if (hold && key === cloudOutboxKey('a')) { entered.resolve(); await saved.promise; }
            await storage.setItem(key, value);
        } }, getRpcClient: () => null, getEdgeInvoker: () => null });
        const unregister = controller.registerHooks();
        await notifyLogin('a');
        const old = controller.getActiveOutbox()!;
        const enqueue = controller.enqueue('upsert_task', { p_id: 'keep-me' });
        await entered.promise;
        const loginB = notifyLogin('b');
        const backA = notifyLogin('a');
        await Promise.resolve();
        expect(controller.getActiveOutbox()).toBeNull();
        hold = false; saved.resolve();
        expect(await enqueue).toBe(false);
        await Promise.all([loginB, backA]);
        const restored = controller.getActiveOutbox()!;
        await restored.flush();
        expect(restored).not.toBe(old);
        expect(restored.snapshot()[0]).toMatchObject({ opId: old.snapshot()[0].opId, payload: { p_id: 'keep-me' } });
        unregister();
    });
    it.each(['rpc', 'edge'] as const)('%sの依存取得待ちに切り替えたら、停止フック到達前でも送信しない', async (route) => {
        const heldHook = deferred();
        registerAuthLifecycleHooks({ onLogin: (id) => id === 'b' ? heldHook.promise : undefined });
        const dependency = deferred();
        const entered = deferred();
        const send = vi.fn(async () => ({ error: null }));
        const controller = createCloudOutboxController({ storage: memory(),
            getRpcClient: async () => { entered.resolve(); await dependency.promise; return { rpc: send }; },
            getEdgeInvoker: async () => { entered.resolve(); await dependency.promise; return async <T>() => { await send(); return {} as T; }; },
        });
        const unregister = controller.registerHooks();
        await notifyLogin('a');
        const old = controller.getActiveOutbox()!;
        await controller.enqueue(route === 'rpc' ? 'upsert_task' : 'complete_task', {});
        await entered.promise;
        const switchUser = notifyLogin('b');
        expect(controller.isActive()).toBe(false);
        expect(controller.getState().availability).toBe('inactive');
        expect(await controller.enqueue('upsert_task', {})).toBe(false);
        dependency.resolve();
        await old.flush();
        expect(send).not.toHaveBeenCalled();
        expect(old.snapshot()[0].status).toBe('pending');
        heldHook.resolve();
        await switchUser;
        expect(controller.getActiveOutbox()!.snapshot()).toEqual([]);
        unregister();
    });

    it('ロード待ちのAは、Bの前段フックが待機中でも復活しない', async () => {
        const load = deferred();
        const entered = deferred();
        const heldHook = deferred();
        const storage = memory();
        registerAuthLifecycleHooks({ onLogin: (id) => id === 'b' ? heldHook.promise : undefined });
        const controller = createCloudOutboxController({ storage: { ...storage, getItem: async (key) => {
            if (key === cloudOutboxKey('a')) { entered.resolve(); await load.promise; }
            return null;
        } }, getRpcClient: () => null, getEdgeInvoker: () => null });
        const unregister = controller.registerHooks();
        const loginA = notifyLogin('a');
        await entered.promise;
        const loginB = notifyLogin('b');
        load.resolve();
        await loginA;
        expect(controller.isActive()).toBe(false);
        heldHook.resolve();
        await loginB;
        expect(controller.isActive()).toBe(true);
        unregister();
    });

    it('遅れたAのenqueue結果をBの依存追跡へ入れない', async () => {
        const storage = memory();
        const saved = deferred();
        const entered = deferred();
        let hold = true;
        const controller = createCloudOutboxController({ storage: { ...storage, setItem: async (key, value) => {
            if (hold && key === cloudOutboxKey('a')) { entered.resolve(); await saved.promise; }
            await storage.setItem(key, value);
        } }, getRpcClient: () => null, getEdgeInvoker: () => null });
        const unregister = controller.registerHooks();
        await notifyLogin('a');
        const queuedA = controller.enqueue('upsert_task', {}, { trackEntityId: 'shared' });
        await entered.promise;
        const switchB = notifyLogin('b');
        hold = false;
        saved.resolve();
        expect(await queuedA).toBe(false);
        await switchB;
        await controller.enqueue('upsert_subtask', {}, { dependsOnEntityIds: ['shared'] });
        await controller.getActiveOutbox()!.flush();
        expect(controller.getActiveOutbox()!.snapshot()[0].dependsOn).toEqual([]);
        expect(JSON.parse(storage.map.get(cloudOutboxKey('a'))!).ops).toHaveLength(1);
        unregister();
    });

    it('logout通知が別のloginに追い越されても、同じAの失効キューは再利用しない', async () => {
        const held = deferred();
        registerAuthLifecycleHooks({ onLogout: () => held.promise });
        const controller = createCloudOutboxController({ storage: memory(), getRpcClient: () => null, getEdgeInvoker: () => null });
        const unregister = controller.registerHooks();
        await notifyLogin('a');
        await controller.enqueue('upsert_task', {});
        const old = controller.getActiveOutbox()!;
        await old.flush();
        const id = old.snapshot()[0].opId;
        const logout = notifyLogout();
        await notifyLogin('a');
        expect(controller.getActiveOutbox()).not.toBe(old);
        expect(controller.getActiveOutbox()!.snapshot()[0].opId).toBe(id);
        held.resolve();
        await logout;
        expect(controller.isActive()).toBe(true);
        unregister();
    });

    it('Edgeが取得したJWTが別ユーザーなら送らず、同じopIdで認証回復を待つ', async () => {
        const fetchFn = vi.fn<typeof fetch>();
        const controller = createCloudOutboxController({ storage: memory(), getRpcClient: () => null,
            getEdgeInvoker: () => createEdgeFunctionInvoker({ functionsUrl: 'https://example.test', anonKey: 'anon',
                getSession: async () => ({ accessToken: 'b-token', userId: 'b' }), refreshSession: async () => null, fetchFn }),
        });
        const unregister = controller.registerHooks();
        await notifyLogin('a');
        await controller.enqueue('complete_task', { taskId: 'task' });
        const outbox = controller.getActiveOutbox()!;
        await outbox.flush();
        expect(fetchFn).not.toHaveBeenCalled();
        expect(outbox.snapshot()[0]).toMatchObject({ status: 'pending', failure: { kind: 'auth-required' } });
        const id = outbox.snapshot()[0].opId;
        await controller.retryPending();
        expect(outbox.snapshot()[0].opId).toBe(id);
        expect(fetchFn).not.toHaveBeenCalled();
        unregister();
    });
});

describe('account-bound RPC transport', () => {
    it.each([null, { accessToken: 'b-token', userId: 'b' }, { accessToken: 'no-owner' }])('所有者不一致/不明のJWTで送信しない (%j)', async (session) => {
        const call = vi.fn(async () => ({ error: null }));
        const client = createAccountBoundOutboxRpcClient({ getSession: async () => ({ session }), call },
            { expectedUserId: 'a', isActive: () => true });
        expect((await client.rpc('upsert_task', {})).error?.code).toBe('401');
        expect(call).not.toHaveBeenCalled();
    });

    it('認証取得後にもscopeを再確認する', async () => {
        let active = true;
        const call = vi.fn(async () => ({ error: null }));
        const client = createAccountBoundOutboxRpcClient({ getSession: async () => {
            active = false;
            return { session: { accessToken: 'a-token', userId: 'a' } };
        }, call }, { expectedUserId: 'a', isActive: () => active });
        expect((await client.rpc('upsert_task', {})).error?.code).toBe('401');
        expect(call).not.toHaveBeenCalled();
    });

    it('検証したJWTを明示的に渡し、SDKのHTTP401をauth-requiredへ分類可能にする', async () => {
        const call = vi.fn(async () => ({ error: { code: 'PGRST301', message: 'expired' }, status: 401 }));
        const client = createAccountBoundOutboxRpcClient({ getSession: async () => ({ session: { accessToken: 'a-token', userId: 'a' } }), call },
            { expectedUserId: 'a', isActive: () => true });
        expect((await client.rpc('upsert_task', { p_key: 'original' })).error?.code).toBe('401');
        expect(call).toHaveBeenCalledExactlyOnceWith('upsert_task', { p_key: 'original' }, 'a-token');
    });
});
