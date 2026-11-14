// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { captureAuthSessionScope, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { cloudCursorKey, cloudOutboxKey } from '@life-quest/core/cloudPull';
import { getGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import type { OutboxOp } from '@life-quest/core/syncOutbox';
import { startAuthSessionListener } from './auth';
import { registerMobileAuthStoreHooks } from './authStores';
import { registerMobileOutboxHooks } from './cloudOutbox';
import { getMobileCloudSyncState, registerMobileCloudSyncHooks } from './cloudSync';
import { getMobileCloudRecoveryState, MOBILE_CLOUD_DISPLAY_OWNER_KEY } from './cloudSessionRecovery';
import { getMobileSupabaseClient, resetMobileSupabaseClient } from './supabase';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';

const device = vi.hoisted(() => ({
    appStorage: new Map<string, string>(),
    secureStorage: new Map<string, string>(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: async (key: string) => device.appStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => { device.appStorage.set(key, value); },
    removeItem: async (key: string) => { device.appStorage.delete(key); },
    getAllKeys: async () => [...device.appStorage.keys()],
} }));
vi.mock('expo-secure-store', () => ({
    getItemAsync: async (key: string) => device.secureStorage.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { device.secureStorage.set(key, value); },
    deleteItemAsync: async (key: string) => { device.secureStorage.delete(key); },
}));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('@react-native-community/netinfo', () => ({ default: {
    addEventListener: (listener: (state: { isConnected: boolean; isInternetReachable: boolean }) => void) => {
        listener({ isConnected: true, isInternetReachable: true });
        return () => {};
    },
} }));
vi.mock('expo-linking', () => ({ getInitialURL: async () => null, addEventListener: () => ({ remove() {} }) }));
vi.mock('expo-auth-session', () => ({ makeRedirectUri: () => 'lifequest://settings' }));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession() {} }));
vi.mock('./appleSignIn', () => ({ signInWithAppleNative: vi.fn() }));
// Keep login bonus handling out of the task synchronization assertions.
vi.mock('../stores/useMobileLoginBonusStore', () => ({
    beginMobileLoginBonusCloudSession: vi.fn(),
    clearMobileLoginBonusCloudSession: vi.fn(),
    requestMobileLoginBonusRecheck: vi.fn(),
    useMobileLoginBonusStore: { getState: vi.fn() },
}));

const owner = 'a1c97a74-0871-4103-875a-a31166e6a1c0';
const otherOwner = 'f2572156-1d4f-40d4-ac7b-51a25beed372';
const taskId = 'a71546a5-d139-4437-a3c7-4496e7ec00a4';
const subtaskId = '4df84c98-f0ee-4760-a234-2bf3470617a4';
const parentOpId = '78809fd1-e883-436a-ab0e-b02a37e8fa58';
const childOpId = '55a99212-bd5b-46ab-9645-99d9fadc36f9';
const endpoint = 'http://127.0.0.1:1';
const sessionKey = 'sb-127-auth-token';
const now = new Date('2026-11-14T01:00:00Z');
const createdAt = now.toISOString();

it('モバイル起動時に認証通信が失敗しても、SDKの自動更新で保留した親子操作を送信して受信する', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', endpoint);
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'mobile-sync-fixture-anon');

    const user = { id: owner, aud: 'authenticated', app_metadata: {}, user_metadata: {} };
    device.secureStorage.set(sessionKey, JSON.stringify({
        user, access_token: 'fixture-expired-access', refresh_token: 'fixture-old-refresh',
        expires_at: now.getTime() / 1000 - 1,
    }));
    device.appStorage.set(MOBILE_CLOUD_DISPLAY_OWNER_KEY, owner);
    const operation = { status: 'pending', baseVersion: null, optimisticSnapshot: null, enqueuedAt: createdAt } as const;
    const parent = { ...operation, opId: parentOpId, operation: 'upsert_task', dependsOn: [],
        payload: { p_id: taskId, p_name: '保留中のタスク' } } satisfies OutboxOp;
    const child = { ...operation, opId: childOpId, operation: 'upsert_subtask', dependsOn: [parentOpId],
        payload: { p_id: subtaskId, p_task_id: taskId, p_name: '保留中のサブタスク' } } satisfies OutboxOp;
    // Put the child first so FIFO alone cannot satisfy the dependency.
    device.appStorage.set(cloudOutboxKey(owner), JSON.stringify({ ops: [child, parent] }));
    const otherQueue = JSON.stringify({ ops: [{ ...parent, opId: 'bbfeee89-6215-453c-b2aa-f95000eecaae' }] });
    device.appStorage.set(cloudOutboxKey(otherOwner), otherQueue);

    let connected = false;
    let failedRefreshes = 0;
    let successfulRefreshes = 0;
    let releaseParent!: () => void;
    const holdParent = new Promise<void>((resolve) => { releaseParent = resolve; });
    const calls: { name: string; bearer: string | null; body: Record<string, unknown> }[] = [];
    const unexpected: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.origin !== endpoint) {
            unexpected.push('non-local request');
            throw new TypeError('Unexpected test endpoint');
        }
        if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
            if (!connected) {
                failedRefreshes += 1;
                // Leave the retry window without running the SDK's automatic refresh timer yet.
                if (failedRefreshes === 1) vi.setSystemTime(new Date(now.getTime() + 120_000));
                throw new TypeError('Simulated connection loss');
            }
            successfulRefreshes += 1;
            return Response.json({ user, access_token: 'fixture-renewed-access', refresh_token: 'fixture-new-refresh',
                expires_in: 3600, token_type: 'bearer' });
        }
        const name = url.pathname.replace('/rest/v1/rpc/', '');
        calls.push({ name, bearer: new Headers(init?.headers).get('Authorization'), body: JSON.parse(String(init?.body ?? '{}')) });
        switch (name) {
            case 'upsert_task':
                await holdParent;
                return Response.json({ id: taskId, version: 6 });
            case 'upsert_subtask':
                return Response.json({ id: subtaskId, version: 7 });
            case 'pull_sync_batch':
                if (savedOperations().length > 0) {
                    unexpected.push('pull while writes were still queued');
                    return Response.json({ next_cursor: 0, has_more: false });
                }
                return Response.json({
                    next_cursor: 7, has_more: false,
                    tasks: [{ id: taskId, name: '受信済みタスク', version: 6, created_at: createdAt }],
                    subtasks: [{ id: subtaskId, task_id: taskId, name: '受信済みサブタスク', version: 7, created_at: createdAt }],
                });
            default:
                unexpected.push(name);
                throw new TypeError('Unexpected test request');
        }
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const savedOperations = (): OutboxOp[] => JSON.parse(device.appStorage.get(cloudOutboxKey(owner))!).ops;
    const client = getMobileSupabaseClient()!;
    // Stub realtime delivery; the SDK still performs auth and REST requests.
    const channel = { on: () => channel, subscribe: () => channel };
    vi.spyOn(client, 'channel').mockReturnValue(channel as unknown as ReturnType<typeof client.channel>);
    vi.spyOn(client, 'removeChannel').mockResolvedValue('ok');
    const cleanups = [registerMobileAuthStoreHooks(), registerMobileOutboxHooks(), registerMobileCloudSyncHooks()];
    const activated = vi.fn();
    cleanups.push(registerAuthLifecycleHooks({ onLogin: activated }), startAuthSessionListener());

    try {
        await vi.waitFor(() => expect(getMobileCloudRecoveryState()).toBe('required'));
        expect(failedRefreshes).toBeGreaterThan(0);
        expect(successfulRefreshes).toBe(0);
        expect(captureAuthSessionScope().userId).toBeNull();
        expect(getGameRewardAuthorityState()).toBe('resolving');
        expect(savedOperations()).toEqual([child, parent]);
        expect(calls).toEqual([]);

        connected = true;
        await vi.advanceTimersByTimeAsync(90_000);
        await vi.waitFor(() => expect(calls.map(({ name }) => name)).toEqual(['upsert_task']));
        expect(savedOperations()).toEqual([child, { ...parent, status: 'inflight' }]);
        expect(useMobileTaskStore.getState().tasks.some(({ id }) => id === taskId)).toBe(false);

        releaseParent();
        await vi.waitFor(() => expect(getMobileCloudSyncState().pull.lastSuccessAt).not.toBeNull());
        expect(successfulRefreshes).toBe(1);
        expect(activated).toHaveBeenCalledExactlyOnceWith(owner);
        expect(getMobileCloudRecoveryState()).toBe('ready');
        expect(getGameRewardAuthorityState()).toBe('authenticated');
        expect(calls.slice(0, 3)).toEqual([
            { name: 'upsert_task', bearer: 'Bearer fixture-renewed-access', body: { ...parent.payload, p_key: parentOpId } },
            { name: 'upsert_subtask', bearer: 'Bearer fixture-renewed-access', body: { ...child.payload, p_key: childOpId } },
            { name: 'pull_sync_batch', bearer: 'Bearer fixture-renewed-access', body: { p_after_version: 0, p_max_versions: 200 } },
        ]);
        expect(calls.filter(({ name }) => name.startsWith('upsert_')).map(({ name }) => name)).toEqual(['upsert_task', 'upsert_subtask']);
        expect(savedOperations()).toEqual([]);
        expect(device.appStorage.get(cloudOutboxKey(otherOwner))).toBe(otherQueue);
        expect(device.appStorage.get(cloudCursorKey(owner))).toBe('7');
        expect(useMobileTaskStore.getState().tasks).toMatchObject([{ id: taskId, name: '受信済みタスク',
            subtasks: [{ id: subtaskId, name: '受信済みサブタスク' }] }]);
        expect(unexpected).toEqual([]);
    } finally {
        releaseParent();
        cleanups.reverse().forEach((cleanup) => cleanup());
        await client.auth.stopAutoRefresh();
        resetMobileSupabaseClient();
        resetAuthLifecycleHooks();
        warn.mockRestore();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.useRealTimers();
    }
});
