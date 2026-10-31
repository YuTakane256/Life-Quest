import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin as notifyScopeLogin, notifyLogout as notifyScopeLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { cloudCacheKey, type CloudCache } from '@life-quest/core/cloudCache';
import { cloudCursorKey, type PullBatch } from '@life-quest/core/cloudPull';
import { createInactiveCloudSyncState } from '@life-quest/core/cloudSyncState';
import type { CloudOutboxPublicState } from '@life-quest/core/cloudOutboxController';
import type { CanonicalTaskSnapshot } from '@life-quest/core/syncSnapshots';

const mocks = vi.hoisted(() => {
    const values = new Map<string, string>();
    const rpc = vi.fn();
    const realtime: Array<() => void> = [];
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    return {
        values, rpc, realtime, storage, sdkUser: 'a' as string | null, headers: [] as string[],
        visibleTasks: [] as string[],
        seeded: vi.fn(), bonus: vi.fn(), drain: vi.fn(), retry: vi.fn(),
        push: { availability: 'ready', pending: 0, inflight: 0, failed: 0, conflict: 0,
            oldestPendingAt: null, lastPushSuccessAt: null, failureKinds: [] } as CloudOutboxPublicState,
        pushListeners: [] as Array<(state: CloudOutboxPublicState) => void>,
        network: [] as Array<(state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void>,
        client: {
            auth: { getSession: async () => ({ data: { session: mocks.sdkUser === null ? null : {
                user: { id: mocks.sdkUser }, access_token: `token-${mocks.sdkUser}`,
            } }, error: null }) },
            rpc: (name: string, params: Record<string, unknown>) => {
                const request = rpc(name, params);
                return Object.assign(request, { setHeader: (_name: string, token: string) => { mocks.headers.push(token); return request; } });
            },
            channel: () => {
                const channel = {
                    on: (_event: string, _filter: unknown, callback: () => void) => {
                        realtime.push(callback);
                        return channel;
                    },
                    subscribe: () => channel,
                };
                return channel;
            },
            removeChannel: vi.fn(),
        },
    };
});

vi.mock('./supabase', () => ({ getWebSupabaseClient: () => mocks.client }));
vi.mock('../../apps/mobile/src/platform/supabase', () => ({ getMobileSupabaseClient: () => mocks.client }));
vi.mock('./storage', () => ({ getPlatformStorageAdapter: () => mocks.storage }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: mocks.storage }));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: vi.fn() }) } }));
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: (callback: (typeof mocks.network)[number]) => {
    mocks.network.push(callback);
    return () => { mocks.network.splice(mocks.network.indexOf(callback), 1); };
} } }));
vi.mock('./authStores', () => ({ markCloudSessionSeeded: mocks.seeded }));
vi.mock('../../apps/mobile/src/platform/authStores', () => ({ markCloudSessionSeeded: mocks.seeded }));
vi.mock('../stores/useLoginBonusStore', () => ({ requestLoginBonusRecheck: mocks.bonus }));
vi.mock('../../apps/mobile/src/stores/useMobileLoginBonusStore', () => ({ requestMobileLoginBonusRecheck: mocks.bonus }));
vi.mock('./canonicalSync', () => ({
    seedTasks: (snapshot: CanonicalTaskSnapshot) => { mocks.visibleTasks = snapshot.tasks.map((task) => task.id); },
    seedHabits: vi.fn(), seedGame: vi.fn(),
}));
vi.mock('../../apps/mobile/src/platform/cloudSeed', () => ({
    applyCloudCacheToMobileStores: (cache: CloudCache) => {
        mocks.visibleTasks = Object.keys(cache.tasks);
        return true;
    },
}));
vi.mock('../stores/useStatsStore', () => ({ useStatsStore: { getState: () => ({ mergeFromCloud: vi.fn() }) } }));
vi.mock('../stores/useThemeStore', () => ({ useThemeStore: { setState: vi.fn() }, sanitizeThemeMode: vi.fn() }));
vi.mock('../stores/useMotionStore', () => ({ useMotionStore: { setState: vi.fn() }, sanitizeMotionMode: vi.fn() }));
vi.mock('../stores/useNotificationStore', () => ({ useNotificationStore: { setState: vi.fn() } }));
vi.mock('./cloudOutbox', () => {
    return {
        drainOutboxAndWait: mocks.drain, retryPendingOutbox: mocks.retry,
        getWebCloudOutboxState: () => mocks.push,
        subscribeWebCloudOutboxState: (callback: (state: CloudOutboxPublicState) => void) => {
            mocks.pushListeners.push(callback);
            return () => { mocks.pushListeners.splice(mocks.pushListeners.indexOf(callback), 1); };
        },
    };
});
vi.mock('../../apps/mobile/src/platform/cloudOutbox', () => {
    return {
        drainOutboxAndWait: mocks.drain, retryPendingOutbox: mocks.retry,
        getMobileCloudOutboxState: () => mocks.push,
        subscribeMobileCloudOutboxState: (callback: (state: CloudOutboxPublicState) => void) => {
            mocks.pushListeners.push(callback);
            return () => { mocks.pushListeners.splice(mocks.pushListeners.indexOf(callback), 1); };
        },
    };
});

import { getActiveWebCloudSync, getWebCloudSyncState, registerWebCloudSyncHooks, startWebCloudSync } from './cloudSync';
import {
    getActiveMobileCloudSync, getMobileCloudSyncState, registerMobileCloudSyncHooks, startMobileCloudSync,
} from '../../apps/mobile/src/platform/cloudSync';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

function batch(user: string, hasMore = false): PullBatch {
    return {
        next_cursor: 2, has_more: hasMore,
        tasks: [{ id: `${user}-task`, name: `${user} private task`, version: 2, deleted_at: null,
            due_date: null, priority: 'low', recurrence: 'none', tags: [], completed: false,
            completed_at: null, created_at: '2026-10-15T00:00:00Z' }],
    };
}
async function notifyLogin(userId: string) { mocks.sdkUser = userId; await notifyScopeLogin(userId); }
async function notifyLogout() { mocks.sdkUser = null; await notifyScopeLogout(); }
const cleanups: Array<() => void> = [];
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

describe('Webの複数タブとキャッシュ復元', () => {
    it('起動時の保存キャッシュ読込を待ち、手動pullの結果を古い読込で上書きしない', async () => {
        const saved = deferred<string | null>();
        mocks.storage.getItem.mockImplementation(async (key: string) => key === cloudCacheKey('a', 'tasks')
            ? saved.promise : mocks.values.get(key) ?? null);
        mocks.rpc.mockResolvedValue({ data: batch('new'), error: null });
        const handle = startWebCloudSync('a')!;
        cleanups.push(handle.stop);
        const pull = handle.flush();
        await settle();
        expect(mocks.rpc).not.toHaveBeenCalled();
        saved.resolve(JSON.stringify({ tasks: { 'a-task': (batch('a').tasks as object[])[0] }, subtasks: {} }));
        await pull;
        expect(mocks.visibleTasks).toEqual(['a-task', 'new-task']);
    });

    it('別タブが保存カーソルを進めても、このタブが未受信の追加と削除を取りこぼさない', async () => {
        const handle = startWebCloudSync('a')!;
        cleanups.push(handle.stop);
        await settle();
        mocks.rpc.mockResolvedValueOnce({ data: batch('a'), error: null });
        await handle.flush();
        expect(mocks.visibleTasks).toEqual(['a-task']);

        // 別タブはversion 10を受信済みだが、このハンドルのキャッシュはversion 2。
        mocks.values.set(cloudCursorKey('a'), '10');
        const update = { next_cursor: 10, has_more: false, tasks: [
            { ...(batch('a').tasks as object[])[0], version: 10, deleted_at: '2026-10-26T00:00:00Z' },
            { ...(batch('new').tasks as object[])[0], version: 10 },
        ] };
        mocks.rpc.mockImplementation(async (_name, params) => ({
            data: params.p_after_version < 10 ? update : { next_cursor: 10, has_more: false }, error: null,
        }));
        await handle.flush();
        expect(mocks.visibleTasks).toEqual(['new-task']);
        expect(mocks.rpc).toHaveBeenLastCalledWith('pull_sync_batch', expect.objectContaining({ p_after_version: 2 }));
    });

    it.each(['old', 'invalid', 'missing'])('保存済みカーソルより%sなキャッシュから起動してもサーバーの行を復元する', async (cacheState) => {
        mocks.values.set(cloudCursorKey('a'), '10');
        if (cacheState === 'old') mocks.values.set(cloudCacheKey('a', 'tasks'), JSON.stringify({
            tasks: { 'a-task': (batch('a').tasks as object[])[0] }, subtasks: {},
        }));
        if (cacheState === 'invalid') mocks.values.set(cloudCacheKey('a', 'tasks'), 'broken JSON');
        mocks.rpc.mockImplementation(async (_name, params) => ({
            data: params.p_after_version < 10 ? {
                next_cursor: 10, has_more: false,
                tasks: [...(batch('a').tasks as object[]), { ...(batch('new').tasks as object[])[0], version: 10 }],
            } : { next_cursor: 10, has_more: false }, error: null,
        }));
        const handle = startWebCloudSync('a')!;
        cleanups.push(handle.stop);
        await settle();
        await handle.flush();
        expect(mocks.visibleTasks).toEqual(['a-task', 'new-task']);
        expect(mocks.rpc).toHaveBeenCalledWith('pull_sync_batch', expect.objectContaining({ p_after_version: 0 }));
    });
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.values.clear();
    mocks.visibleTasks = []; mocks.sdkUser = 'a'; mocks.headers.length = 0;
    mocks.realtime.length = 0;
    mocks.network.length = 0; mocks.pushListeners.length = 0;
    Object.assign(mocks.push, { ...createInactiveCloudSyncState().push, availability: 'ready' });
    mocks.storage.getItem.mockReset().mockImplementation(async (key: string) => mocks.values.get(key) ?? null);
    mocks.storage.setItem.mockReset().mockImplementation(async (key: string, value: string) => { mocks.values.set(key, value); });
    mocks.rpc.mockReset().mockResolvedValue({ data: { next_cursor: 0, has_more: false }, error: null });
    // Hold automatic startup recovery; tests explicitly flush the real pull runner.
    mocks.drain.mockReset().mockReturnValue(new Promise(() => {}));
    mocks.retry.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    resetAuthLifecycleHooks();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

for (const platform of [
    { name: 'Web', register: registerWebCloudSyncHooks, active: getActiveWebCloudSync, state: getWebCloudSyncState, start: startWebCloudSync },
    { name: 'Mobile', register: registerMobileCloudSyncHooks, active: getActiveMobileCloudSync, state: getMobileCloudSyncState, start: startMobileCloudSync },
]) {
    describe(`${platform.name} cloud sync session boundaries`, () => {
        const network = (online: boolean | null) => {
            if (platform.name === 'Web') {
                if (online !== null) window.dispatchEvent(new Event(online ? 'online' : 'offline'));
            } else {
                for (const callback of [...mocks.network]) callback({ isConnected: online === false ? false : true, isInternetReachable: online });
            }
        };
        const start = async () => { cleanups.push(platform.register()); await notifyLogin('a'); await settle(); };

        it('SDKだけBへ切り替わったらAの受信を送らず、Aのキャッシュとカーソルを保持する', async () => {
            await start();
            mocks.rpc.mockResolvedValue({ data: batch('a'), error: null });
            await platform.active()!.flush();
            const before = [...mocks.values.entries()]; const visible = [...mocks.visibleTasks];
            mocks.rpc.mockClear(); mocks.sdkUser = 'b';
            mocks.rpc.mockResolvedValue({ data: batch('b'), error: null });
            await expect(platform.active()!.flush()).rejects.toThrow(/cloud pull/);
            expect(mocks.rpc).not.toHaveBeenCalled();
            expect([...mocks.values.entries()]).toEqual(before); expect(mocks.visibleTasks).toEqual(visible);
            mocks.sdkUser = 'a';
            await platform.active()!.flush();
            expect(mocks.rpc).toHaveBeenCalledOnce();
        });

        it('受信中にSDKだけBへ切り替わったら応答を適用せず、Aの保存を保持する', async () => {
            await start();
            mocks.rpc.mockResolvedValue({ data: batch('a'), error: null });
            await platform.active()!.flush();
            const before = [...mocks.values.entries()]; const visible = [...mocks.visibleTasks];
            const response = deferred<{ data: PullBatch; error: null }>();
            mocks.rpc.mockReturnValueOnce(response.promise);
            const pending = platform.active()!.flush(); await settle();
            mocks.sdkUser = 'b'; response.resolve({ data: batch('new'), error: null });
            await expect(pending).rejects.toThrow(/cloud pull/);
            expect([...mocks.values.entries()]).toEqual(before); expect(mocks.visibleTasks).toEqual(visible);
            expect(mocks.headers.at(-1)).toBe('Bearer token-a');
        });

        it('SDKセッションがない間は受信せず、同じAの復帰で通常受信へ戻る', async () => {
            await start(); mocks.sdkUser = null;
            await expect(platform.active()!.flush()).rejects.toThrow(/cloud pull/);
            expect(mocks.rpc).not.toHaveBeenCalled();
            mocks.sdkUser = 'a'; mocks.rpc.mockResolvedValue({ data: batch('a'), error: null });
            await platform.active()!.flush();
            expect(mocks.visibleTasks).toEqual(['a-task']);
        });

        it('publishes offline/online, preserves offline across unknown, and does not manually send offline', async () => {
            await start();
            network(false);
            expect(platform.state().availability).toBe('offline');
            network(null);
            expect(platform.state().availability).toBe('offline');
            await platform.active()!.syncNow();
            expect(mocks.retry).not.toHaveBeenCalled();
            expect(mocks.rpc).not.toHaveBeenCalled();
            network(true);
            expect(platform.state().availability).toBe('ready');
            await platform.active()!.syncNow();
            expect(mocks.retry).toHaveBeenCalledTimes(1);
            expect(platform.state().pull).toMatchObject({ phase: 'idle', lastSuccessAt: expect.any(String) });
        });

        it('coalesces same-tick manual requests and publishes pulling instead of old success', async () => {
            await start(); await platform.active()!.syncNow();
            const lastSuccess = platform.state().pull.lastSuccessAt;
            const retry = deferred<void>(); const response = deferred<{ data: PullBatch; error: null }>();
            mocks.retry.mockClear().mockReturnValueOnce(retry.promise);
            mocks.rpc.mockClear().mockReturnValueOnce(response.promise);
            const first = platform.active()!.syncNow();
            const second = platform.active()!.syncNow();
            expect(first).toBe(second); expect(mocks.retry).toHaveBeenCalledTimes(1);
            retry.resolve(); await settle();
            expect(platform.state().pull).toEqual({ phase: 'pulling', lastSuccessAt: lastSuccess });
            expect(platform.state().attention).toBe('waiting'); expect(mocks.rpc).toHaveBeenCalledTimes(1);
            response.resolve({ data: batch('a'), error: null }); await first;
            expect(platform.state().pull.phase).toBe('idle');
        });

        it('settles a rejected retry without raw errors and allows another attempt', async () => {
            await start();
            mocks.retry.mockRejectedValueOnce(new Error('private server details'));
            await expect(platform.active()!.syncNow()).resolves.toBeUndefined();
            expect(platform.state().pull.phase).toBe('failed');
            expect(platform.state().attention).toBe('required');
            expect(JSON.stringify(platform.state())).not.toContain('private');
            await platform.active()!.syncNow();
            expect(platform.state().pull.phase).toBe('idle'); expect(mocks.retry).toHaveBeenCalledTimes(2);
        });

        it('does not invite manual retry for auth-required, but same-user auth recovery can resume', async () => {
            await start();
            mocks.push.failureKinds = ['auth-required'];
            for (const callback of mocks.pushListeners) callback({ ...mocks.push });
            expect(platform.state().availability).toBe('auth-required');
            await platform.active()!.syncNow(); expect(mocks.retry).not.toHaveBeenCalled();
            mocks.push.failureKinds = [];
            for (const callback of mocks.pushListeners) callback({ ...mocks.push });
            await notifyLogin('a'); await platform.active()!.syncNow();
            expect(platform.state().availability).toBe('ready'); expect(mocks.retry).toHaveBeenCalledTimes(1);
        });

        it('does not pull if connectivity is lost during retry', async () => {
            await start();
            const retry = deferred<void>(); mocks.retry.mockReturnValueOnce(retry.promise);
            const pending = platform.active()!.syncNow(); network(false); retry.resolve(); await pending;
            expect(mocks.rpc).not.toHaveBeenCalled(); expect(platform.state().availability).toBe('offline');
        });

        it('old manual failure cannot change B or release B manual request', async () => {
            await start();
            let reject!: (error: Error) => void;
            mocks.retry.mockReturnValueOnce(new Promise<void>((_resolve, fail) => { reject = fail; }));
            const old = platform.active()!.syncNow();
            await notifyLogin('b'); await settle();
            const gate = deferred<void>(); mocks.retry.mockReturnValueOnce(gate.promise);
            const current = platform.active()!.syncNow(); const stateB = platform.state();
            reject(new Error('old')); await old;
            expect(platform.state()).toEqual(stateB);
            expect(platform.active()!.syncNow()).toBe(current);
            gate.resolve(); await current;
            expect(mocks.rpc).toHaveBeenCalledTimes(1);
        });

        it('keeps an in-flight pull valid across a same-user notification', async () => {
            cleanups.push(platform.register());
            await notifyLogin('a');
            await settle();
            const response = deferred<{ data: PullBatch; error: null }>();
            mocks.rpc.mockReturnValueOnce(response.promise);
            const pull = platform.active()!.flush();
            await settle();
            await notifyLogin('a');
            response.resolve({ data: batch('a'), error: null });
            await pull;
            expect(mocks.visibleTasks).toEqual(['a-task']);
            expect(mocks.values.get(cloudCursorKey('a'))).toBe('2');
        });

        it('restarts A when a delayed logout was superseded by a new A login', async () => {
            const gate = deferred<void>();
            cleanups.push(registerAuthLifecycleHooks({ onLogout: () => gate.promise }));
            cleanups.push(platform.register());
            await notifyLogin('a');
            await settle();
            const previous = platform.active();
            const logout = notifyLogout();
            await notifyLogin('a');
            expect(platform.active()).not.toBe(previous);
            mocks.rpc.mockResolvedValue({ data: batch('a'), error: null });
            await platform.active()!.flush();
            expect(mocks.visibleTasks).toEqual(['a-task']);
            gate.resolve();
            await logout;
        });

        for (const transition of ['logout', 'switch'] as const) {
            it(`invalidates the old pull before delayed ${transition} hooks reach sync shutdown`, async () => {
                const gate = deferred<void>();
                cleanups.push(registerAuthLifecycleHooks({
                    onLogin: (userId) => userId === 'b' ? gate.promise : undefined,
                    onLogout: () => gate.promise,
                }));
                cleanups.push(platform.register());
                await notifyLogin('a');
                await settle();
                const response = deferred<{ data: PullBatch; error: null }>();
                mocks.rpc.mockReturnValueOnce(response.promise);
                const pullA = platform.active()!.flush();
                await settle();
                const changing = transition === 'logout' ? notifyLogout() : notifyLogin('b');
                response.resolve({ data: batch('a', true), error: null });
                await pullA;
                expect(mocks.visibleTasks).toEqual([]);
                expect(mocks.seeded).not.toHaveBeenCalled();
                expect(mocks.storage.setItem).not.toHaveBeenCalled();
                expect(mocks.rpc).toHaveBeenCalledTimes(1);
                gate.resolve();
                await changing;
            });
        }

        it('does not resume an old manual sync after its outbox retry finishes', async () => {
            cleanups.push(platform.register());
            await notifyLogin('a');
            await settle();
            const retry = deferred<void>();
            mocks.retry.mockReturnValueOnce(retry.promise);
            const oldSync = platform.active()!.syncNow();
            await notifyLogin('b');
            await settle();
            retry.resolve();
            await oldSync;
            expect(mocks.rpc).not.toHaveBeenCalled();
            expect(mocks.bonus).not.toHaveBeenCalled();
        });

        it('keeps active startup recovery and failure/retry feedback working', async () => {
            mocks.drain.mockResolvedValue({ retryablePending: false });
            mocks.rpc.mockResolvedValue({ data: batch('a'), error: null });
            cleanups.push(platform.register());
            await notifyLogin('a');
            await settle();
            expect(mocks.visibleTasks).toEqual(['a-task']);
            expect(mocks.bonus).toHaveBeenCalledTimes(1);
            expect(platform.state().pull.phase).toBe('idle');
            mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
            await platform.active()!.syncNow();
            expect(platform.state().pull.phase).toBe('failed');
            expect(mocks.visibleTasks).toEqual(['a-task']);
            await platform.active()!.syncNow();
            expect(platform.state().pull.phase).toBe('idle');
            expect(mocks.visibleTasks).toEqual(['a-task']);
        });

        it('does not apply a response arriving after logout or fetch another page', async () => {
            cleanups.push(platform.register());
            await notifyLogin('a');
            await settle();
            const response = deferred<{ data: PullBatch; error: null }>();
            mocks.rpc.mockReturnValueOnce(response.promise);
            const handle = platform.active()!;
            const pull = handle.flush();
            await settle();
            expect(mocks.rpc).toHaveBeenCalledTimes(1);
            await notifyLogout();
            response.resolve({ data: batch('a', true), error: null });
            await pull;
            expect(mocks.visibleTasks).toEqual([]);
            expect(mocks.seeded).not.toHaveBeenCalled();
            expect(mocks.storage.setItem).not.toHaveBeenCalled();
            expect(mocks.rpc).toHaveBeenCalledTimes(1);
            expect(platform.state()).toEqual(createInactiveCloudSyncState());
            await handle.flush();
            await handle.syncNow();
            mocks.realtime[0]?.(); // Already queued before unsubscribe.
            await settle();
            expect(mocks.rpc).toHaveBeenCalledTimes(1);
            expect(mocks.retry).not.toHaveBeenCalled();
        });

        it('keeps B visible when A responds after an account switch', async () => {
            cleanups.push(platform.register());
            await notifyLogin('a');
            await settle();
            const response = deferred<{ data: PullBatch; error: null }>();
            mocks.rpc.mockReturnValueOnce(response.promise).mockResolvedValue({ data: batch('b'), error: null });
            const pullA = platform.active()!.flush();
            await settle();
            await notifyLogin('b');
            await settle();
            await platform.active()!.flush();
            const stateB = platform.state();
            expect(mocks.visibleTasks).toEqual(['b-task']);
            response.resolve({ data: batch('a', true), error: null });
            await pullA;
            expect(mocks.visibleTasks).toEqual(['b-task']);
            expect(platform.state()).toEqual(stateB);
            expect(mocks.values.has(cloudCacheKey('a', 'tasks'))).toBe(false);
            expect(mocks.values.has(cloudCursorKey('a'))).toBe(false);
            expect(mocks.values.get(cloudCursorKey('b'))).toBe('2');
            expect(mocks.rpc).toHaveBeenCalledTimes(2);
        });

        it('does not seed A or start more writes if stopped during cache persistence', async () => {
            cleanups.push(platform.register());
            await notifyLogin('a');
            await settle();
            const saved = deferred<void>();
            mocks.storage.setItem.mockImplementation(async (key: string, value: string) => {
                if (key === cloudCacheKey('a', 'tasks')) await saved.promise;
                mocks.values.set(key, value);
            });
            mocks.rpc.mockResolvedValueOnce({ data: batch('a'), error: null }).mockResolvedValue({ data: batch('b'), error: null });
            const pullA = platform.active()!.flush();
            await settle();
            expect(mocks.storage.setItem).toHaveBeenCalledWith(cloudCacheKey('a', 'tasks'), expect.any(String));
            await notifyLogin('b');
            await settle();
            await platform.active()!.flush();
            saved.resolve();
            await pullA;
            expect(mocks.visibleTasks).toEqual(['b-task']);
            expect(mocks.values.has(cloudCursorKey('a'))).toBe(false);
            // An already-started storage write cannot be cancelled. No further A writes may start.
            const oldWrites = mocks.storage.setItem.mock.calls.filter(([key]) => key.startsWith('life-quest:cloud:a:'));
            expect(oldWrites.map(([key]) => key)).toEqual([cloudCacheKey('a', 'tasks')]);
        });

        it('also discards a superseded generation even if its handle was not explicitly stopped', async () => {
            const a = platform.start('a')!;
            cleanups.push(a.stop);
            await settle();
            const response = deferred<{ data: PullBatch; error: null }>();
            mocks.rpc.mockReturnValueOnce(response.promise).mockResolvedValue({ data: batch('b'), error: null });
            const pullA = a.flush();
            await settle();
            mocks.sdkUser = 'b'; // Direct startup also follows the SDK owner.
            const b = platform.start('b')!;
            cleanups.push(b.stop);
            await settle();
            await b.flush();
            response.resolve({ data: batch('a'), error: null });
            await pullA;
            expect(mocks.visibleTasks).toEqual(['b-task']);
            expect(mocks.values.has(cloudCursorKey('a'))).toBe(false);
        });
    });
}
