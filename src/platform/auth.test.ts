import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGameRewardAuthorityState, setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import {
    clearPendingWebRewardOperations,
    deferWebRewardOperation,
    getPendingWebRewardOperations,
    pendingWebRewardOperationsKey,
    restorePendingWebRewardOperations,
} from './pendingRewardOperations';
import { useGameStore, sanitizeGameStoreState } from '../stores/useGameStore';
import { CLOUD_SESSION_RECOVERY_PREFIX } from './authStores';
import { flushCompletionRewardWrites, seedCloudCompletionRewardStorage, resetCompletionRewardStorage, COMPLETION_REWARD_LOCK } from './completionRewards';

const state = vi.hoisted(() => ({
    listener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    resend: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: { url: 'https://accounts.google.com/example' }, error: null })),
    signUp: vi.fn(async () => ({ data: { user: { id: 'user-1' }, session: null }, error: null })),
    getSession: vi.fn(async (): Promise<{ data: { session: { user: { id: string } } | null }; error?: Error | null }> => ({
        data: { session: { user: { id: 'user-1' } } }, error: null,
    })),
    refreshSession: vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    invoke: vi.fn(async () => ({ recorded: true })),
    notifyLogin: vi.fn(async () => undefined),
    notifyTokenRefreshed: vi.fn(async () => undefined),
    notifyLogout: vi.fn(async () => undefined),
}));

vi.mock('./supabase', () => ({
    getWebSupabaseClient: vi.fn(() => ({
        auth: {
            resetPasswordForEmail: state.resetPasswordForEmail,
            resend: state.resend,
            updateUser: state.updateUser,
            exchangeCodeForSession: state.exchangeCodeForSession,
            signUp: state.signUp,
            signInWithOAuth: state.signInWithOAuth,
            getSession: state.getSession,
            refreshSession: state.refreshSession,
            signInWithPassword: state.signInWithPassword,
            signOut: state.signOut,
            onAuthStateChange: vi.fn((listener: typeof state.listener) => {
                state.listener = listener;
                return { data: { subscription: { unsubscribe: vi.fn() } } };
            }),
        },
    })),
}));

vi.mock('@life-quest/core/authLifecycle', () => ({
    captureAuthSessionScope: () => ({ userId: null }),
    notifyLogin: state.notifyLogin,
    notifyTokenRefreshed: state.notifyTokenRefreshed,
    notifyLogout: state.notifyLogout,
}));

vi.mock('./edgeFunctions', () => ({
    getWebEdgeFunctionInvoker: vi.fn(() => state.invoke),
}));

import {
    getPasswordRecoveryState,
    requestPasswordReset,
    resendEmailVerification,
    cancelPasswordRecovery,
    clearPasswordRecoveryState,
    clearGoogleOAuthState,
    clearAppleOAuthState,
    handleWebAppleOAuthCallback,
    handleWebGoogleOAuthCallback,
    signUpWithEmail,
    signInWithGoogle,
    signInWithApple,
    startAuthSessionListener,
    updatePasswordFromRecovery,
} from './auth';

describe('Web auth pending reward ownership', () => {
    afterEach(() => {
        state.listener = null;
        setGameRewardAuthorityState('anonymous');
        clearPendingWebRewardOperations();
        localStorage.clear();
        clearPasswordRecoveryState();
        clearGoogleOAuthState();
        clearAppleOAuthState();
        window.history.replaceState(null, '', '/settings');
        vi.clearAllMocks();
        state.getSession.mockReset();
    });

    it('SIGNED_OUTは保留メモリを切り離し、同じuser namespaceの保存キーは残す', () => {
        restorePendingWebRewardOperations('user-a');
        deferWebRewardOperation({ key: 'task-1', priority: 'medium', completedAt: '2026-07-29T00:00:00.000Z', xpReward: 20 });
        const stop = startAuthSessionListener();
        try {
            state.listener?.('SIGNED_OUT', null);
            expect(getGameRewardAuthorityState()).toBe('anonymous');
            expect(getPendingWebRewardOperations()).toEqual([]);
            expect(localStorage.getItem(pendingWebRewardOperationsKey('user-a'))).toContain('task-1');
        } finally {
            stop();
        }
    });

    it('INITIAL_SESSION=null archives a persisted cloud cache and enables anonymous rewards', async () => {
        vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => unknown) => work() } });
        seedCloudCompletionRewardStorage(() => useGameStore.setState(sanitizeGameStoreState({ character: { totalXp: 110 } })));
        await flushCompletionRewardWrites();
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', null);
            await vi.waitFor(() => expect(getGameRewardAuthorityState()).toBe('anonymous'));
            expect(useGameStore.getState().character.totalXp).toBe(0);
            expect(Object.keys(localStorage).some((key) => key.startsWith(CLOUD_SESSION_RECOVERY_PREFIX))).toBe(true);
            expect(JSON.parse(localStorage.getItem('quest-board-game')!).state.completionRewardScope).toBe('anonymous');
        } finally { stop(); vi.unstubAllGlobals(); }
    });

    it('a newer SIGNED_IN invalidates pending no-session cache isolation', async () => {
        vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => unknown) => work() } });
        seedCloudCompletionRewardStorage(() => useGameStore.setState(sanitizeGameStoreState({ character: { totalXp: 110 } })));
        await flushCompletionRewardWrites();
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', null);
            state.listener?.('SIGNED_IN', { user: { id: 'user-new' } });
            await vi.waitFor(() => expect(getGameRewardAuthorityState()).toBe('authenticated'));
            expect(useGameStore.getState().character.totalXp).toBe(110);
            expect(Object.keys(localStorage).filter((key) => key.startsWith(CLOUD_SESSION_RECOVERY_PREFIX))).toHaveLength(0);
        } finally { stop(); vi.unstubAllGlobals(); }
    });

    it('初期セッションなしから更新に成功すると、退避を済ませて本人の保留操作を復元する', async () => {
        vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => unknown) => work() } });
        seedCloudCompletionRewardStorage(() => useGameStore.setState(sanitizeGameStoreState({ character: { totalXp: 110 } })));
        await flushCompletionRewardWrites();
        const operation = { key: 'task-a', priority: 'medium' as const, completedAt: '2026-07-29T00:00:00.000Z', xpReward: 20 };
        localStorage.setItem(pendingWebRewardOperationsKey('user-1'), JSON.stringify([operation]));
        let atLogin: { xp: number; archived: boolean; operations: ReturnType<typeof getPendingWebRewardOperations> } | undefined;
        state.notifyLogin.mockImplementationOnce(async () => {
            atLogin = {
                xp: useGameStore.getState().character.totalXp,
                archived: Object.keys(localStorage).some((key) => key.startsWith(CLOUD_SESSION_RECOVERY_PREFIX)),
                operations: getPendingWebRewardOperations(),
            };
        });
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', null);
            state.listener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
            expect(state.notifyLogin).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(getGameRewardAuthorityState()).toBe('authenticated'));
            expect(state.notifyLogin).toHaveBeenCalledExactlyOnceWith('user-1');
            expect(atLogin).toEqual({ xp: 0, archived: true, operations: [operation] });
        } finally { stop(); vi.unstubAllGlobals(); }
    });

    it('クラウドデータの退避に失敗したときは更新通知を受けても初回移行を始めない', async () => {
        vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => unknown) => work() } });
        seedCloudCompletionRewardStorage(() => useGameStore.setState(sanitizeGameStoreState({ character: { totalXp: 110 } })));
        await flushCompletionRewardWrites();
        const setItem = Storage.prototype.setItem;
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
            if (key.startsWith(CLOUD_SESSION_RECOVERY_PREFIX)) throw new Error('fixture storage is full');
            setItem.call(this, key, value);
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', null);
            state.listener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
            await vi.waitFor(() => expect(warn).toHaveBeenCalled());
            expect(state.getSession).not.toHaveBeenCalled();
            expect(state.notifyLogin).not.toHaveBeenCalled();
            expect(getGameRewardAuthorityState()).toBe('resolving');
            expect(useGameStore.getState().character.totalXp).toBe(110);
        } finally { stop(); warn.mockRestore(); write.mockRestore(); vi.unstubAllGlobals(); }
    });

    it('匿名で起動した後も、更新通知と現在のSDKセッションが一致した場合にだけ同期を始める', async () => {
        state.getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'other-user' } } } });
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', null);
            await vi.waitFor(() => expect(getGameRewardAuthorityState()).toBe('anonymous'));
            state.listener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
            await vi.waitFor(() => expect(state.getSession).toHaveBeenCalledOnce());
            expect(state.notifyLogin).not.toHaveBeenCalled();
            state.listener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
            await vi.waitFor(() => expect(state.notifyLogin).toHaveBeenCalledExactlyOnceWith('user-1'));
            await vi.waitFor(() => expect(getGameRewardAuthorityState()).toBe('authenticated'));
        } finally { stop(); }
    });

    it('更新後のSDK確認中にログアウトすると遅い結果から同期を始めない', async () => {
        let complete!: (value: Awaited<ReturnType<typeof state.getSession>>) => void;
        state.getSession.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', null);
            state.listener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
            await vi.waitFor(() => expect(state.getSession).toHaveBeenCalledOnce());
            state.listener?.('SIGNED_OUT', null);
            complete({ data: { session: { user: { id: 'user-1' } } } });
            await Promise.resolve();
            expect(state.notifyLogin).not.toHaveBeenCalled();
            expect(state.notifyLogout).toHaveBeenCalledOnce();
            expect(getGameRewardAuthorityState()).toBe('anonymous');
        } finally { complete?.({ data: { session: null } }); stop(); }
    });

    it('パスワード復旧の保存ゲートがある場合は更新通知から通常同期へ進まない', async () => {
        localStorage.setItem('life-quest:auth:recovery-pending:v1', '1');
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', null);
            state.listener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
            await Promise.resolve();
            expect(getPasswordRecoveryState()).toBe('invalid');
            expect(state.getSession).not.toHaveBeenCalled();
            expect(state.notifyLogin).not.toHaveBeenCalled();
        } finally { stop(); }
    });

    it('TOKEN_REFRESHED does not strand an in-progress login in resolving', async () => {
        let finish!: () => void;
        state.notifyLogin.mockReturnValueOnce(new Promise<undefined>((resolve) => { finish = () => resolve(undefined); }));
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', { user: { id: 'user-1' } });
            state.listener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
            finish();
            await vi.waitFor(() => expect(getGameRewardAuthorityState()).toBe('authenticated'));
        } finally { stop(); }
    });

    it('settles a held startup game save before INITIAL_SESSION=null changes authority generation', async () => {
        await flushCompletionRewardWrites();
        let tail = Promise.resolve();
        const manager = { request: (_name: string, work: () => unknown) => {
            const result = tail.then(work);
            tail = result.then(() => undefined, () => undefined);
            return result;
        } };
        vi.stubGlobal('navigator', { locks: manager });
        setGameRewardAuthorityState('resolving');
        resetCompletionRewardStorage(() => useGameStore.setState(sanitizeGameStoreState(undefined)));
        await flushCompletionRewardWrites();
        let release!: () => void;
        const held = manager.request(COMPLETION_REWARD_LOCK, () => new Promise<void>((resolve) => { release = resolve; }));
        await Promise.resolve();
        useGameStore.getState().updateCharacter({ name: 'Canonical startup profile' });
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', null);
            expect(getGameRewardAuthorityState()).toBe('resolving');
            release();
            await held;
            await vi.waitFor(() => expect(getGameRewardAuthorityState()).toBe('anonymous'));
            expect(JSON.parse(localStorage.getItem('quest-board-game')!).state.character.name).toBe('Canonical startup profile');
        } finally { stop(); await flushCompletionRewardWrites(); vi.unstubAllGlobals(); }
    });

    it('登録後にセッションが無い時は確認メール待ちを返す', async () => {
        await expect(signUpWithEmail('new@example.com', 'secret1')).resolves.toEqual({ ok: true, emailVerificationPending: true });
        expect(state.signUp).toHaveBeenCalledWith(expect.objectContaining({
            email: 'new@example.com',
            password: 'secret1',
            options: expect.objectContaining({ emailRedirectTo: expect.stringContaining('/settings?auth=verify') }),
        }));
    });

    it('再設定・確認メールは指定したアドレスでSupabaseへ要求する', async () => {
        await requestPasswordReset('person@example.com');
        await resendEmailVerification('person@example.com');
        expect(state.resetPasswordForEmail).toHaveBeenCalledWith('person@example.com', expect.objectContaining({ redirectTo: expect.stringContaining('/settings') }));
        expect(state.resend).toHaveBeenCalledWith(expect.objectContaining({ type: 'signup', email: 'person@example.com' }));
    });

    it('確認メール再送はSupabaseエラー時も同じ中立的な応答を返す', async () => {
        state.resend.mockResolvedValueOnce({ error: new Error('User not found') } as never);
        await expect(resendEmailVerification('unknown@example.com')).resolves.toEqual({ ok: true });
    });

    it('Google OAuthは専用settings callbackへ開始し、ここでは同期通知しない', async () => {
        await expect(signInWithGoogle()).resolves.toEqual({ ok: true });
        expect(state.signInWithOAuth).toHaveBeenCalledWith({
            provider: 'google',
            options: { redirectTo: 'http://localhost:3000/settings?auth=oauth' },
        });
        expect(state.notifyLogin).not.toHaveBeenCalled();
    });

    it('Google OAuth callbackはcodeだけを一度交換し、履歴を消去する', async () => {
        window.history.replaceState(null, '', '/settings?auth=oauth&code=google-code');
        await handleWebGoogleOAuthCallback();
        window.history.replaceState(null, '', '/settings?auth=oauth&code=google-code&repeat=1');
        await handleWebGoogleOAuthCallback();
        expect(state.exchangeCodeForSession).toHaveBeenCalledTimes(1);
        expect(state.exchangeCodeForSession).toHaveBeenCalledWith('google-code');
        expect(state.notifyLogin).not.toHaveBeenCalled();
        expect(window.location.pathname).toBe('/settings');
        expect(window.location.search).toBe('');
        expect(window.location.hash).toBe('');
    });

    it('Google OAuth callbackのtoken、provider error、異なる画面は交換しない', async () => {
        window.history.replaceState(null, '', '/settings?auth=oauth&access_token=token');
        await handleWebGoogleOAuthCallback();
        window.history.replaceState(null, '', '/settings?auth=oauth&error=access_denied');
        await handleWebGoogleOAuthCallback();
        window.history.replaceState(null, '', '/tasks?auth=oauth&code=wrong-target');
        await handleWebGoogleOAuthCallback();
        expect(state.exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it('Apple OAuthは専用callbackを使い、同期通知を直接開始しない', async () => {
        await expect(signInWithApple()).resolves.toEqual({ ok: true });
        expect(state.signInWithOAuth).toHaveBeenCalledWith({
            provider: 'apple',
            options: { redirectTo: 'http://localhost:3000/settings?auth=apple-oauth' },
        });
        expect(state.notifyLogin).not.toHaveBeenCalled();
    });

    it('Apple callbackはcodeだけを一度交換して履歴を消去する', async () => {
        state.exchangeCodeForSession.mockResolvedValueOnce({
            data: { session: { provider_refresh_token: 'provider-refresh-token' } }, error: null,
        } as never);
        window.history.replaceState(null, '', '/settings?auth=apple-oauth&code=apple-code');
        await handleWebAppleOAuthCallback();
        window.history.replaceState(null, '', '/settings?auth=apple-oauth&code=apple-code&repeat=1');
        await handleWebAppleOAuthCallback();
        expect(state.exchangeCodeForSession).toHaveBeenCalledTimes(1);
        expect(state.exchangeCodeForSession).toHaveBeenCalledWith('apple-code');
        expect(state.invoke).toHaveBeenCalledWith('record_apple_refresh_token', { refresh_token: 'provider-refresh-token' });
        expect(state.notifyLogin).not.toHaveBeenCalled();
        expect(window.location.pathname).toBe('/settings');
        expect(window.location.search).toBe('');
    });

    it('Apple callbackはtoken、provider error、異なる画面を拒否する', async () => {
        window.history.replaceState(null, '', '/settings?auth=apple-oauth&access_token=token');
        await handleWebAppleOAuthCallback();
        window.history.replaceState(null, '', '/settings?auth=apple-oauth&error=access_denied');
        await handleWebAppleOAuthCallback();
        window.history.replaceState(null, '', '/tasks?auth=apple-oauth&code=wrong-target');
        await handleWebAppleOAuthCallback();
        expect(state.exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it('PASSWORD_RECOVERYイベントの後にだけパスワードを更新する', async () => {
        await expect(updatePasswordFromRecovery('secret1')).resolves.toMatchObject({ ok: false });
        const stop = startAuthSessionListener();
        try {
            state.listener?.('PASSWORD_RECOVERY', { user: { id: 'user-1' } });
            await vi.waitFor(() => expect(getPasswordRecoveryState()).toBe('ready'));
            state.listener?.('SIGNED_IN', { user: { id: 'user-1' } });
            expect(getGameRewardAuthorityState()).toBe('resolving');
            await vi.waitFor(() => expect(getPasswordRecoveryState()).toBe('ready'));
            await expect(updatePasswordFromRecovery('secret1')).resolves.toEqual({ ok: true });
            expect(state.updateUser).toHaveBeenCalledWith({ password: 'secret1' });
            expect(getGameRewardAuthorityState()).toBe('authenticated');
        } finally {
            stop();
        }
    });

    it('復旧URLの認証パラメータを処理後すぐ履歴から除去する', () => {
        window.history.replaceState(null, '', '/settings?auth=recovery&code=secret&type=recovery#access_token=token');
        const stop = startAuthSessionListener();
        try {
            state.listener?.('PASSWORD_RECOVERY', { user: { id: 'user-1' } });
            expect(window.location.pathname).toBe('/settings');
            expect(window.location.search).toBe('');
            expect(window.location.hash).toBe('');
        } finally {
            stop();
        }
    });

    it('永続された復旧ゲートは初期セッションを通常ログインとして処理しない', async () => {
        localStorage.setItem('life-quest:auth:recovery-pending:v1', '1');
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', { user: { id: 'user-1' } });
            await vi.waitFor(() => expect(getPasswordRecoveryState()).toBe('ready'));
            expect(getGameRewardAuthorityState()).toBe('resolving');
        } finally {
            stop();
        }
    });

    it('無効な復旧コールバックでもゲートがある限り初期セッションを有効化しない', () => {
        window.history.replaceState(null, '', '/settings?auth=recovery&error=access_denied&error_code=otp_expired');
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', { user: { id: 'user-1' } });
            expect(getPasswordRecoveryState()).toBe('invalid');
            expect(getGameRewardAuthorityState()).toBe('resolving');
            expect(state.notifyLogin).not.toHaveBeenCalled();
        } finally {
            stop();
        }
    });

    it('復旧のキャンセルはsignOut成功後だけゲートを解除し、失敗時は状態を維持する', async () => {
        const stop = startAuthSessionListener();
        try {
            state.listener?.('PASSWORD_RECOVERY', { user: { id: 'user-1' } });
            await vi.waitFor(() => expect(getPasswordRecoveryState()).toBe('ready'));
            state.signOut.mockResolvedValueOnce({ error: new Error('offline') } as never);
            await expect(cancelPasswordRecovery()).resolves.toMatchObject({ ok: false });
            expect(getPasswordRecoveryState()).toBe('ready');
            await expect(cancelPasswordRecovery()).resolves.toEqual({ ok: true });
            expect(getPasswordRecoveryState()).toBe('idle');
            expect(localStorage.getItem('life-quest:auth:recovery-pending:v1')).toBeNull();
        } finally {
            stop();
        }
    });

    it('Supabaseの生エラーをログイン画面向けに返さない', async () => {
        state.signInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: new Error('User not found') } as never);
        const { signInWithEmail } = await import('./auth');
        await expect(signInWithEmail('unknown@example.com', 'secret1')).resolves.toEqual({
            ok: false,
            message: '操作を完了できませんでした。入力内容と接続を確認して、時間をおいてもう一度お試しください。',
        });
    });
});
