import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyCloudCache, type CloudCache } from '@life-quest/core/cloudCache';
import { cloudCursorKey, type PullBatch } from '@life-quest/core/cloudPull';
import { createInactiveCloudSyncState } from '@life-quest/core/cloudSyncState';
import { resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import type { CanonicalTaskSnapshot } from '@life-quest/core/syncSnapshots';

const f = vi.hoisted(() => ({
    data: new Map<string, string>(),
    visibleTasks: [] as string[],
    realtime: new Map<string, () => void>(),
    net: null as null | ((state: { isConnected: boolean; isInternetReachable: boolean }) => void),
    app: null as null | ((state: string) => void),
    load: vi.fn<() => Promise<CloudCache>>(),
    drain: vi.fn(async () => ({ retryablePending: false })),
    rpc: vi.fn(async (_platform: string, _params: Record<string, unknown>): Promise<{ data: PullBatch; error: null }> => ({ data: { next_cursor: 8, has_more: false }, error: null })),
}));
const storage = {
    getItem: async (key: string) => f.data.get(key) ?? null,
    setItem: async (key: string, value: string) => { f.data.set(key, value); },
    removeItem: async (key: string) => { f.data.delete(key); },
};
function client(platform: string) {
    const channel = { on: (_kind: string, _filter: unknown, cb: () => void) => { f.realtime.set(platform, cb); return channel; }, subscribe: () => channel };
    return { rpc: (_name: string, params: Record<string, unknown>) => f.rpc(platform, params), channel: () => channel, removeChannel: async () => {} };
}
function outboxState() { return { ...createInactiveCloudSyncState().push, availability: 'ready' as const }; }
vi.mock('@life-quest/core/cloudCache', async (original) => ({ ...await original<typeof import('@life-quest/core/cloudCache')>(), loadCloudCache: () => f.load() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: async (key: string) => f.data.get(key) ?? null,
    setItem: async (key: string, value: string) => { f.data.set(key, value); },
    removeItem: async (key: string) => { f.data.delete(key); },
} }));
vi.mock('./storage', async (original) => ({ ...await original<typeof import('./storage')>(), getPlatformStorageAdapter: () => storage }));
vi.mock('./supabase', () => ({ getWebSupabaseClient: () => client('web') }));
vi.mock('../../apps/mobile/src/platform/supabase', () => ({ getMobileSupabaseClient: () => client('mobile') }));
vi.mock('./cloudOutbox', () => ({ drainOutboxAndWait: () => f.drain(), retryPendingOutbox: () => f.drain(), getWebCloudOutboxState: outboxState, subscribeWebCloudOutboxState: () => () => {} }));
vi.mock('../../apps/mobile/src/platform/cloudOutbox', () => ({ drainOutboxAndWait: () => f.drain(), retryPendingOutbox: () => f.drain(), getMobileCloudOutboxState: outboxState, subscribeMobileCloudOutboxState: () => () => {} }));
vi.mock('./authStores', () => ({ markCloudSessionSeeded: vi.fn() }));
vi.mock('../../apps/mobile/src/platform/authStores', () => ({ markCloudSessionSeeded: vi.fn() }));
vi.mock('./canonicalSync', () => ({
    seedGame: vi.fn(), seedHabits: vi.fn(),
    seedTasks: (snapshot: CanonicalTaskSnapshot) => { f.visibleTasks = snapshot.tasks.map((task) => task.id); },
}));
vi.mock('../../apps/mobile/src/platform/cloudSeed', () => ({ applyCloudCacheToMobileStores: (cache: CloudCache) => {
    f.visibleTasks = Object.keys(cache.tasks);
    return true;
} }));
vi.mock('../../apps/mobile/src/platform/cloudSessionRecovery', () => ({ rememberMobileCloudDisplayOwner: async () => {} }));
vi.mock('../stores/useLoginBonusStore', () => ({ requestLoginBonusRecheck: vi.fn() }));
vi.mock('../../apps/mobile/src/stores/useMobileLoginBonusStore', () => ({ requestMobileLoginBonusRecheck: vi.fn() }));
vi.mock('react-native', () => ({ AppState: { addEventListener: (_event: string, cb: (state: string) => void) => { f.app = cb; return { remove() { f.app = null; } }; } } }));
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: (cb: typeof f.net) => { f.net = cb; return () => { f.net = null; }; } } }));

import { startWebCloudSync } from './cloudSync';
import { startMobileCloudSync } from '../../apps/mobile/src/platform/cloudSync';
const handles: { stop: () => void }[] = [];
const settle = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
    vi.useFakeTimers(); resetAuthLifecycleHooks(); f.data.clear(); f.realtime.clear(); f.visibleTasks = [];
    f.load.mockReset().mockResolvedValue(createEmptyCloudCache());
    f.drain.mockReset().mockResolvedValue({ retryablePending: false });
    f.rpc.mockReset().mockResolvedValue({ data: {
        next_cursor: 8, has_more: false,
        tasks: [{ id: 'new-task', name: 'New task', version: 8, deleted_at: null,
            due_date: null, priority: 'low', recurrence: 'none', tags: [], completed: false,
            completed_at: null, created_at: '2026-10-30T00:00:00Z' }],
    }, error: null });
});
afterEach(() => { handles.splice(0).forEach((h) => h.stop()); vi.useRealTimers(); resetAuthLifecycleHooks(); });

describe.each([{ platform: 'web', start: startWebCloudSync }, { platform: 'mobile', start: startMobileCloudSync }])('$platform automatic sync ordering (event/transport stubs)', ({ platform, start }) => {
    function begin() { const h = start('owner-a')!; handles.push(h); return h; }
    function triggerSync(trigger: string) {
        if (trigger === 'realtime') f.realtime.get(platform)!();
        else if (trigger === 'foreground') {
            if (platform === 'mobile') f.app!('active');
            else document.dispatchEvent(new Event('visibilitychange'));
        } else if (trigger === 'reconnect') {
            if (platform === 'mobile') {
                f.net!({ isConnected: false, isInternetReachable: false });
                f.net!({ isConnected: true, isInternetReachable: true });
            } else window.dispatchEvent(new Event('online'));
        }
    }
    it.each(['realtime', 'timer', 'foreground', 'reconnect'])('%s waits for retryable writes, then resumes on the next trigger', async (trigger) => {
        begin(); await settle(); f.rpc.mockClear(); f.drain.mockClear();
        f.visibleTasks = ['optimistic-task'];
        f.drain.mockResolvedValue({ retryablePending: true });
        if (trigger === 'timer') await vi.advanceTimersByTimeAsync(5 * 60_000);
        else triggerSync(trigger);
        await settle();
        expect(f.drain).toHaveBeenCalled();
        expect(f.rpc).not.toHaveBeenCalled();
        expect(f.visibleTasks).toEqual(['optimistic-task']);
        f.drain.mockResolvedValue({ retryablePending: false });
        triggerSync('realtime'); await settle();
        expect(f.rpc).toHaveBeenCalled();
        expect(f.visibleTasks).toEqual(['new-task']);
    });
    it('realtime waits for both cache initialization and pending-write completion', async () => {
        const loaded = deferred<CloudCache>(); const sent = deferred<{ retryablePending: boolean }>();
        f.load.mockReturnValueOnce(loaded.promise); f.drain.mockReturnValue(sent.promise);
        begin(); f.realtime.get(platform)!(); await settle();
        expect(f.rpc).not.toHaveBeenCalled();
        loaded.resolve(createEmptyCloudCache()); await settle();
        expect(f.rpc).not.toHaveBeenCalled();
        sent.resolve({ retryablePending: false }); await settle();
        expect(f.rpc).toHaveBeenCalled();
        expect(f.visibleTasks).toEqual(['new-task']);
    });
    it('a direct flush also waits for cache load and keeps its newer rows', async () => {
        const loaded = deferred<CloudCache>(); f.load.mockReturnValueOnce(loaded.promise);
        f.drain.mockReturnValue(new Promise(() => {})); // Isolate explicit flush from startup recovery.
        const h = begin(); const pulled = h.flush(); await settle();
        expect(f.rpc).not.toHaveBeenCalled();
        loaded.resolve(createEmptyCloudCache()); await pulled;
        expect(f.visibleTasks).toEqual(['new-task']);
        await settle();
        expect(f.visibleTasks).toEqual(['new-task']);
    });
    it('stopping during cache initialization discards late callbacks', async () => {
        const loaded = deferred<CloudCache>(); f.load.mockReturnValueOnce(loaded.promise);
        const h = begin(); f.realtime.get(platform)!(); h.stop();
        loaded.resolve(createEmptyCloudCache()); await settle();
        expect(f.rpc).not.toHaveBeenCalled();
    });
    it('a saved cursor alone cannot skip missing rows on a fresh handle', async () => {
        f.data.set(cloudCursorKey('owner-a'), '80');
        const h = begin(); await settle();
        expect(f.rpc.mock.calls[0]?.[1].p_after_version).toBe(0);
        await h.flush();
        expect(f.rpc.mock.calls.at(-1)?.[1].p_after_version).toBe(8);
    });
    it('cache read failure can recover from a full pull instead of trusting the saved cursor', async () => {
        f.data.set(cloudCursorKey('owner-a'), '80'); f.load.mockRejectedValueOnce(new Error('temporary read failure'));
        begin(); await settle();
        expect(f.rpc.mock.calls[0]?.[1].p_after_version).toBe(0);
    });
});
