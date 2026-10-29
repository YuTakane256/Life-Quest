import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAuthSessionScope, notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';

const mocks = vi.hoisted(() => ({
    configured: true, session: vi.fn(), invoke: vi.fn(), cleanup: vi.fn(), detachWeb: vi.fn(), detachMobile: vi.fn(), signOut: vi.fn(), authority: vi.fn(), restoreMobile: vi.fn(),
    identities: new Set<(event: string, session: { user: { id: string } } | null) => void>(),
    subscribe: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
        mocks.identities.add(listener); return { data: { subscription: { unsubscribe: () => { mocks.identities.delete(listener); } } } };
    },
}));
vi.mock('./supabase', () => ({ getWebSupabaseClient: () => mocks.configured ? { auth: { getSession: mocks.session, signOut: mocks.signOut, onAuthStateChange: mocks.subscribe } } : null }));
vi.mock('../../apps/mobile/src/platform/supabase', () => ({ getMobileSupabaseClient: () => mocks.configured ? { auth: { getSession: mocks.session, signOut: mocks.signOut, onAuthStateChange: mocks.subscribe } } : null }));
vi.mock('./edgeFunctions', () => ({ getWebEdgeFunctionInvoker: () => mocks.configured ? mocks.invoke : null }));
vi.mock('../../apps/mobile/src/platform/edgeFunctions', () => ({ getMobileEdgeFunctionInvoker: () => mocks.configured ? mocks.invoke : null }));
vi.mock('./accountDeletion', () => ({ cleanupDeletedWebAccount: mocks.cleanup }));
vi.mock('../../apps/mobile/src/platform/accountDeletion', () => ({ cleanupDeletedMobileAccount: mocks.cleanup }));
vi.mock('./pendingRewardOperations', () => ({ detachPendingWebRewardOperations: mocks.detachWeb, restorePendingWebRewardOperations: vi.fn() }));
vi.mock('../../apps/mobile/src/platform/pendingRewardOperations', () => ({ detachPendingRewardOperations: mocks.detachMobile, restorePendingRewardOperations: mocks.restoreMobile }));
vi.mock('./completionRewards', () => ({ flushCompletionRewardWrites: vi.fn() }));
vi.mock('./authStores', () => ({ hasPersistedCloudGame: vi.fn(), prepareWebAnonymousSession: vi.fn() }));
vi.mock('@life-quest/core/gameRewardAuthority', () => ({ setGameRewardAuthorityState: mocks.authority }));
vi.mock('expo-linking', () => ({ getInitialURL: vi.fn(), addEventListener: vi.fn() }));
vi.mock('expo-auth-session', () => ({ makeRedirectUri: vi.fn() }));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), getAllKeys: vi.fn(async () => []), setItem: vi.fn(), removeItem: vi.fn() } }));
vi.mock('../../apps/mobile/src/platform/appleSignIn', () => ({ signInWithAppleNative: vi.fn() }));
import { deleteCurrentAccount as deleteWeb } from './auth';
import { deleteCurrentAccount as deleteMobile, startAuthSessionListener as startMobileListener } from '../../apps/mobile/src/platform/auth';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); mocks.configured = true;
    mocks.session.mockReset().mockResolvedValue({ data: { session: { user: { id: 'a' } } }, error: null });
    mocks.invoke.mockReset().mockResolvedValue({ apple_revocation: 'manual_required' });
    mocks.cleanup.mockReset().mockResolvedValue(undefined); mocks.detachWeb.mockReset(); mocks.detachMobile.mockReset();
    mocks.signOut.mockReset().mockResolvedValue({ error: null }); mocks.authority.mockReset();
    mocks.identities.clear(); mocks.restoreMobile.mockReset().mockResolvedValue(undefined);
});
afterEach(() => resetAuthLifecycleHooks());

describe.each([{ name: 'Web', remove: deleteWeb }, { name: 'Mobile', remove: deleteMobile }])('$name退会アダプター（実service＋共有operation、SDKはスタブ）', ({ name, remove }) => {
    const approval = () => ({ userId: 'a', isActive: captureAuthSessionScope().isCurrent });
    it('本人確認・既存invokerの対象制約・local signOut・Apple案内を接続する', async () => {
        expect(await remove(approval())).toMatchObject({ ok: true, manualAppleRevocationRequired: true });
        expect(mocks.invoke).toHaveBeenCalledOnce();
        expect(mocks.invoke).toHaveBeenCalledWith('delete_account', {}, { expectedUserId: 'a', isActive: expect.any(Function) });
        expect(mocks.cleanup).toHaveBeenCalledWith('a', expect.any(Function));
        expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' }); expect(mocks.authority).toHaveBeenCalledWith('anonymous');
        if (name === 'Web') expect(mocks.detachWeb).toHaveBeenCalledOnce();
        else expect(mocks.detachMobile).toHaveBeenCalledWith({ suppressAnonymousRecovery: true });
    });
    it('Supabase未設定では要求しない', async () => {
        mocks.configured = false; expect(await remove(approval())).toMatchObject({ ok: false }); expect(mocks.invoke).not.toHaveBeenCalled();
    });
    it.each(['mismatch', 'error'])('SDKセッションの%sでは要求しない', async (kind) => {
        mocks.session.mockResolvedValue({ data: { session: { user: { id: kind === 'mismatch' ? 'b' : 'a' } } }, error: kind === 'error' ? new Error('fixture') : null });
        const result = await remove(approval()); expect(result.ok).toBe(false); expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.cleanup).not.toHaveBeenCalled();
        if (!result.ok && kind === 'error') expect(result.message).toContain('削除要求は送信していません');
    });
    it('送信結果不明では自動再送・ローカル削除・signOutを開始しない', async () => {
        mocks.invoke.mockRejectedValue(new Error('timeout')); const result = await remove(approval());
        expect(result.ok).toBe(false); if (!result.ok) expect(result.message).toContain('自動では再送しません');
        expect(mocks.invoke).toHaveBeenCalledOnce(); expect(mocks.cleanup).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled();
    });
    it('RPC待機中の切替後には片付けしない', async () => {
        const wait = deferred<{ apple_revocation: string }>(); mocks.invoke.mockImplementationOnce(async () => { await notifyLogin('b'); return wait.promise; });
        const task = remove(approval()); wait.resolve({ apple_revocation: 'manual_required' }); expect(await task).toMatchObject({ ok: false });
        expect(mocks.cleanup).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled(); expect(mocks.authority).not.toHaveBeenCalled();
    });
    it('片付け待機中の切替後はBをsignOutしない', async () => {
        mocks.cleanup.mockImplementationOnce(async (_userId, isCurrent: () => boolean) => { expect(isCurrent()).toBe(true); await notifyLogin('b'); expect(isCurrent()).toBe(false); });
        expect(await remove(approval())).toMatchObject({ ok: false }); expect(mocks.signOut).not.toHaveBeenCalled(); expect(mocks.authority).not.toHaveBeenCalled();
    });
    it('SDKがthrowせずerrorを返すsignOut失敗も再起動案内にする', async () => {
        mocks.signOut.mockResolvedValue({ error: new Error('SDK error') }); const result = await remove(approval());
        expect(result.ok).toBe(false); if (!result.ok) expect(result.message).toContain('アカウントは削除されました');
        expect(result.completionScope?.()).toBe(true); expect(captureAuthSessionScope().userId).toBeNull();
    });
    it('SDKのSIGNED_OUT相当が先に届いても成功案内を維持する', async () => {
        mocks.signOut.mockImplementationOnce(async () => { mocks.identities.forEach((listener) => listener('SIGNED_OUT', null)); await notifyLogout(); return { error: null }; });
        const result = await remove(approval()); expect(result.ok).toBe(true); expect(result.completionScope?.()).toBe(true);
        expect(mocks.identities.size).toBe(0);
    });
    it('共有scope未更新のSDK切替でも次のsignOutを開始しない', async () => {
        mocks.cleanup.mockImplementationOnce(async () => { mocks.identities.forEach((event) => event('SIGNED_IN', { user: { id: 'b' } })); });
        expect(await remove(approval())).toMatchObject({ ok: false });
        expect(captureAuthSessionScope().userId).toBe('a'); expect(mocks.signOut).not.toHaveBeenCalled(); expect(mocks.authority).not.toHaveBeenCalled();
    });
});

it('実Mobile auth listenerの旧A停止・報酬復元待機中でも、SDK Bへの旧削除のcleanupを開始しない', async () => {
    const restore = deferred<void>(); const rpc = deferred<{ apple_revocation: string }>();
    mocks.restoreMobile.mockReturnValueOnce(restore.promise); mocks.invoke.mockReturnValueOnce(rpc.promise);
    const stop = startMobileListener(); await Promise.resolve(); await Promise.resolve();
    mocks.authority.mockClear();
    const pending = deleteMobile({ userId: 'a', isActive: captureAuthSessionScope().isCurrent });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
    mocks.identities.forEach((event) => event('SIGNED_IN', { user: { id: 'b' } }));
    await vi.waitFor(() => expect(mocks.restoreMobile).toHaveBeenCalledWith('b')); expect(captureAuthSessionScope().userId).toBeNull();
    rpc.resolve({ apple_revocation: 'manual_required' }); expect(await pending).toMatchObject({ ok: false });
    expect(mocks.cleanup).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled();
    restore.resolve(); await vi.waitFor(() => expect(captureAuthSessionScope().userId).toBe('b')); stop(); expect(mocks.identities.size).toBe(0);
});
