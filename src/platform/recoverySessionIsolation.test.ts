import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAuthSessionGuard, captureAuthSessionScope, notifyLogin, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { getGameRewardAuthorityState, setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { createCloudOutboxController } from '@life-quest/core/cloudOutboxController';
import { cloudOutboxKey } from '@life-quest/core/cloudPull';
import AsyncStorage from '@react-native-async-storage/async-storage';

const sdk = vi.hoisted(() => ({
    owner: 'b',
    listeners: new Map<string, (event: string, session: { user: { id: string } } | null) => void>(),
    storage: new Map<string, string>(),
    update: vi.fn(async () => ({ error: null })),
}));
function client(platform: string) {
    return { auth: {
        getSession: async () => ({ data: { session: sdk.owner ? { user: { id: sdk.owner } } : null }, error: null }),
        updateUser: sdk.update,
        onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
            sdk.listeners.set(platform, listener);
            return { data: { subscription: { unsubscribe: () => sdk.listeners.delete(platform) } } };
        },
    } };
}
vi.mock('./supabase', () => ({ getWebSupabaseClient: () => client('web') }));
vi.mock('../../apps/mobile/src/platform/supabase', () => ({ getMobileSupabaseClient: () => client('mobile') }));
vi.mock('./authStores', () => ({ hasPersistedCloudGame: () => false, prepareWebAnonymousSession: async () => {} }));
vi.mock('./completionRewards', () => ({ flushCompletionRewardWrites: async () => {} }));
vi.mock('./edgeFunctions', () => ({ getWebEdgeFunctionInvoker: () => null }));
vi.mock('../../apps/mobile/src/platform/edgeFunctions', () => ({ getMobileEdgeFunctionInvoker: () => null }));
vi.mock('./accountDeletion', () => ({ cleanupDeletedWebAccount: async () => {} }));
vi.mock('../../apps/mobile/src/platform/accountDeletion', () => ({ cleanupDeletedMobileAccount: async () => {} }));
vi.mock('./pendingRewardOperations', () => ({ detachPendingWebRewardOperations: vi.fn(), restorePendingWebRewardOperations: vi.fn() }));
vi.mock('../../apps/mobile/src/platform/pendingRewardOperations', () => ({ detachPendingRewardOperations: vi.fn(), restorePendingRewardOperations: async () => {} }));
vi.mock('../../apps/mobile/src/platform/cloudSessionRecovery', () => ({
    beginMobileCloudSessionCheck: vi.fn(), finishMobileCloudSessionCheck: vi.fn(),
    checkMobileCloudSessionOwner: async () => true, getMobileCloudRecoveryState: () => 'ready', isMobileCloudSessionAccepted: () => true,
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: async (key: string) => sdk.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { sdk.storage.set(key, value); },
    removeItem: async (key: string) => { sdk.storage.delete(key); },
} }));
vi.mock('expo-linking', () => ({ getInitialURL: async () => null, addEventListener: () => ({ remove() {} }) }));
vi.mock('expo-auth-session', () => ({ makeRedirectUri: () => 'lifequest://settings' }));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession() {} }));
vi.mock('../../apps/mobile/src/platform/appleSignIn', () => ({ signInWithAppleNative: vi.fn() }));

import * as web from './auth';
import * as mobile from '../../apps/mobile/src/platform/auth';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((finish) => { resolve = finish; });
    return { promise, resolve };
}

beforeEach(() => {
    resetAuthLifecycleHooks(); sdk.listeners.clear(); sdk.storage.clear(); localStorage.clear();
    window.history.replaceState(null, '', '/settings');
    sdk.owner = 'b'; sdk.update.mockReset().mockResolvedValue({ error: null });
    web.clearPasswordRecoveryState(); mobile.clearPasswordRecoveryState();
});
afterEach(() => { resetAuthLifecycleHooks(); setGameRewardAuthorityState('resolving'); });

describe.each([{ platform: 'web', auth: web }, { platform: 'mobile', auth: mobile }])('$platform recovery session isolation (real lifecycle, stub SDK)', ({ platform, auth }) => {
    async function start() {
        const stop = auth.startAuthSessionListener();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return stop;
    }
    it('TOKEN_REFRESHED during password recovery cannot notify normal cloud resume', async () => {
        await notifyLogin('b'); const refresh = vi.fn();
        registerAuthLifecycleHooks({ onTokenRefreshed: refresh });
        const stop = await start();
        try {
            emit('PASSWORD_RECOVERY'); await Promise.resolve();
            emit('TOKEN_REFRESHED'); await Promise.resolve();
            expect(refresh).not.toHaveBeenCalled();
        } finally { stop(); }
    });
    function emit(event: string, owner: string | null = 'b') {
        sdk.owner = owner ?? '';
        sdk.listeners.get(platform)!(event, owner ? { user: { id: owner } } : null);
    }

    it.each(['PASSWORD_RECOVERY', 'SIGNED_IN'])('%s invalidates A before waiting, preserves its queued work and starts B only after password update', async (event) => {
        if (event === 'SIGNED_IN') {
            if (platform === 'web') localStorage.setItem('life-quest:auth:recovery-pending:v1', '1');
            else sdk.storage.set('life-quest:auth:recovery-pending:v1', '1');
        }
        const leaving = deferred<void>();
        const started: string[] = [];
        const controller = createCloudOutboxController({ storage: {
            getItem: async (key) => sdk.storage.get(key) ?? null,
            setItem: async (key, value) => { sdk.storage.set(key, value); },
            removeItem: async (key) => { sdk.storage.delete(key); },
        }, getRpcClient: () => null, getEdgeInvoker: () => null });
        const unregister = controller.registerHooks();
        registerAuthLifecycleHooks({ onLogin: (id) => { started.push(id); }, onLogout: () => leaving.promise });
        await notifyLogin('a');
        const workerA = captureAuthSessionGuard();
        await controller.enqueue('upsert_task', { p_id: 'a-task', p_name: 'A only' }, { trackEntityId: 'a-task' });
        await controller.enqueue('upsert_subtask', { p_id: 'a-child', p_task_id: 'a-task', p_name: 'A child' }, { dependsOnEntityIds: ['a-task'] });
        await controller.getActiveOutbox()!.flush();
        const identity = (ops: { opId: string; payload: unknown; dependsOn: string[] }[]) => ops.map(({ opId, payload, dependsOn }) => ({ opId, payload, dependsOn }));
        const queuedA = identity(controller.getActiveOutbox()!.snapshot());
        expect(queuedA[1].dependsOn).toContain(queuedA[0].opId);
        const stop = await start(); setGameRewardAuthorityState('authenticated');
        try {
            emit(event);
            expect(workerA()).toBe(false);
            expect(captureAuthSessionScope().userId).toBeNull();
            expect(getGameRewardAuthorityState()).toBe('resolving');
            expect(auth.getPasswordRecoveryState()).not.toBe('ready');
            expect(started).toEqual(['a']);
            expect(controller.isActive()).toBe(false);
            leaving.resolve();
            await vi.waitFor(() => expect(auth.getPasswordRecoveryState()).toBe('ready'));
            expect(await auth.updatePasswordFromRecovery('new-test-password')).toEqual({ ok: true });
            expect(started).toEqual(['a', 'b']);
            expect(captureAuthSessionScope().userId).toBe('b');
            expect(identity(JSON.parse(sdk.storage.get(cloudOutboxKey('a'))!).ops)).toEqual(queuedA);
            expect(controller.getActiveOutbox()!.snapshot()).toEqual([]);
        } finally { leaving.resolve(); stop(); unregister(); }
    });

    it('duplicate recovery events cannot bypass pending A cleanup', async () => {
        const leaving = deferred<void>();
        registerAuthLifecycleHooks({ onLogout: () => leaving.promise }); await notifyLogin('a');
        const stop = await start();
        try {
            emit('PASSWORD_RECOVERY'); emit('PASSWORD_RECOVERY');
            await Promise.resolve(); await Promise.resolve();
            expect(auth.getPasswordRecoveryState()).not.toBe('ready');
            leaving.resolve();
            await vi.waitFor(() => expect(auth.getPasswordRecoveryState()).toBe('ready'));
        } finally { leaving.resolve(); stop(); }
    });

    it('recovery gate write failure still stops A and never enables a password update', async () => {
        await notifyLogin('a');
        const workerA = captureAuthSessionGuard();
        const stop = await start();
        const broken = platform === 'web'
            ? vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('disk full'); })
            : vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
        try {
            emit('PASSWORD_RECOVERY');
            expect(workerA()).toBe(false);
            await vi.waitFor(() => expect(auth.getPasswordRecoveryState()).toBe('invalid'));
            expect(await auth.updatePasswordFromRecovery('new-test-password')).toMatchObject({ ok: false });
            expect(sdk.update).not.toHaveBeenCalled();
            expect(captureAuthSessionScope().userId).toBeNull();
        } finally { broken.mockRestore(); stop(); }
    });

    it('late recovery cleanup cannot enable a form after sign out', async () => {
        const leaving = deferred<void>();
        registerAuthLifecycleHooks({ onLogout: () => leaving.promise }); await notifyLogin('a');
        const stop = await start();
        try {
            emit('PASSWORD_RECOVERY'); emit('SIGNED_OUT', null); leaving.resolve();
            await vi.waitFor(() => expect(getGameRewardAuthorityState()).toBe('anonymous'));
            expect(auth.getPasswordRecoveryState()).not.toBe('ready');
        } finally { leaving.resolve(); stop(); }
    });

    it.each(['SIGNED_OUT', 'PASSWORD_RECOVERY'])('late password-update response cannot override a newer %s', async (event) => {
        const stop = await start();
        try {
            emit('PASSWORD_RECOVERY');
            await vi.waitFor(() => expect(auth.getPasswordRecoveryState()).toBe('ready'));
            const updated = deferred<{ error: null }>(); sdk.update.mockReturnValueOnce(updated.promise);
            const saving = auth.updatePasswordFromRecovery('new-test-password');
            await vi.waitFor(() => expect(sdk.update).toHaveBeenCalledOnce());
            emit(event, event === 'SIGNED_OUT' ? null : 'c'); updated.resolve({ error: null });
            expect(await saving).toMatchObject({ ok: false });
            expect(captureAuthSessionScope().userId).toBeNull();
            expect(getGameRewardAuthorityState()).not.toBe('authenticated');
            if (event === 'PASSWORD_RECOVERY') await vi.waitFor(() => expect(auth.getPasswordRecoveryState()).toBe('ready'));
        } finally { stop(); }
    });
});
