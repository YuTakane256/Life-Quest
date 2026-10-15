import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { cloudCacheKey, type CloudCache } from '@life-quest/core/cloudCache';
import { cloudCursorKey, type PullBatch } from '@life-quest/core/cloudPull';
import { createInactiveCloudSyncState } from '@life-quest/core/cloudSyncState';
import type { CanonicalTaskSnapshot } from '@life-quest/core/syncSnapshots';

const mocks = vi.hoisted(() => {
    const values = new Map<string, string>();
    const rpc = vi.fn();
    const realtime: Array<() => void> = [];
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    return {
        values, rpc, realtime, storage,
        visibleTasks: [] as string[],
        seeded: vi.fn(), bonus: vi.fn(), drain: vi.fn(), retry: vi.fn(),
        client: {
            rpc,
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
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: () => vi.fn() } }));
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
vi.mock('./cloudOutbox', async () => {
    const { createInactiveCloudSyncState: inactive } = await import('@life-quest/core/cloudSyncState');
    const state = { ...inactive().push, availability: 'ready' as const };
    return {
        drainOutboxAndWait: mocks.drain, retryPendingOutbox: mocks.retry,
        getWebCloudOutboxState: () => state,
        subscribeWebCloudOutboxState: () => vi.fn(),
    };
});
vi.mock('../../apps/mobile/src/platform/cloudOutbox', async () => {
    const { createInactiveCloudSyncState: inactive } = await import('@life-quest/core/cloudSyncState');
    const state = { ...inactive().push, availability: 'ready' as const };
    return {
        drainOutboxAndWait: mocks.drain, retryPendingOutbox: mocks.retry,
        getMobileCloudOutboxState: () => state,
        subscribeMobileCloudOutboxState: () => vi.fn(),
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
const cleanups: Array<() => void> = [];
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.values.clear();
    mocks.visibleTasks = [];
    mocks.realtime.length = 0;
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
});

for (const platform of [
    { name: 'Web', register: registerWebCloudSyncHooks, active: getActiveWebCloudSync, state: getWebCloudSyncState, start: startWebCloudSync },
    { name: 'Mobile', register: registerMobileCloudSyncHooks, active: getActiveMobileCloudSync, state: getMobileCloudSyncState, start: startMobileCloudSync },
]) {
    describe(`${platform.name} cloud sync session boundaries`, () => {
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
