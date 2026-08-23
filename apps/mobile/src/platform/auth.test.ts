import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGameRewardAuthorityState, setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { consumeAnonymousRecoverySuppression } from './pendingRewardOperations';

const state = vi.hoisted(() => ({
    listener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    resend: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: { url: 'https://accounts.google.com/example' }, error: null })),
    openAuthSessionAsync: vi.fn(async () => ({ type: 'success', url: 'lifequest://auth/callback?code=google-code' })),
    signUp: vi.fn(async () => ({ data: { user: { id: 'user-1' }, session: null }, error: null })),
    getSession: vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } } })),
    signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    recoveryGate: null as string | null,
    storageReadError: false,
    storageWriteError: false,
    notifyLogin: vi.fn(async () => undefined),
    notifyLogout: vi.fn(async () => undefined),
}));

vi.mock('expo-linking', () => ({
    getInitialURL: vi.fn(async () => null),
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
}));

vi.mock('expo-auth-session', () => ({
    makeRedirectUri: vi.fn(() => 'lifequest://auth/callback'),
}));

vi.mock('expo-web-browser', () => ({
    maybeCompleteAuthSession: vi.fn(),
    openAuthSessionAsync: state.openAuthSessionAsync,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => {
            if (state.storageReadError) throw new Error('storage unavailable');
            return state.recoveryGate;
        }),
        setItem: vi.fn(async (_key: string, value: string) => {
            if (state.storageWriteError) throw new Error('storage unavailable');
            state.recoveryGate = value;
        }),
        removeItem: vi.fn(async () => {
            if (state.storageWriteError) throw new Error('storage unavailable');
            state.recoveryGate = null;
        }),
    },
}));

vi.mock('./supabase', () => ({
    getMobileSupabaseClient: vi.fn(() => ({
        auth: {
            resetPasswordForEmail: state.resetPasswordForEmail,
            resend: state.resend,
            updateUser: state.updateUser,
            exchangeCodeForSession: state.exchangeCodeForSession,
            signInWithOAuth: state.signInWithOAuth,
            signUp: state.signUp,
            getSession: state.getSession,
            signInWithPassword: state.signInWithPassword,
            signOut: state.signOut,
            // Vitest hoists mock factories before TypeScript transforms this callback.
            onAuthStateChange: vi.fn((listener) => {
                state.listener = listener;
                return { data: { subscription: { unsubscribe: vi.fn() } } };
            }),
        },
    })),
}));

vi.mock('@life-quest/core/authLifecycle', () => ({
    notifyLogin: state.notifyLogin,
    notifyLogout: state.notifyLogout,
}));

vi.mock('./edgeFunctions', () => ({
    getMobileEdgeFunctionInvoker: vi.fn(() => null),
}));

vi.mock('./accountDeletion', () => ({
    cleanupDeletedMobileAccount: vi.fn(async () => undefined),
}));

import {
    getPasswordRecoveryState,
    handleMobileAuthCallbackUrl,
    handleMobileGoogleOAuthCallbackUrl,
    handleMobilePasswordRecoveryUrl,
    requestPasswordReset,
    resendEmailVerification,
    cancelPasswordRecovery,
    clearPasswordRecoveryState,
    signUpWithEmail,
    signInWithGoogle,
    startAuthSessionListener,
    updatePasswordFromRecovery,
} from './auth';

describe('Mobile auth reward authority', () => {
    afterEach(() => {
        state.listener = null;
        setGameRewardAuthorityState('anonymous');
        state.recoveryGate = null;
        state.storageReadError = false;
        state.storageWriteError = false;
        clearPasswordRecoveryState();
        vi.clearAllMocks();
    });

    it('TOKEN_REFRESHEDでresolvingへ戻さず、保留操作の再処理を招かない', async () => {
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', { user: { id: 'user-1' } });
            await vi.waitFor(() => expect(getGameRewardAuthorityState()).toBe('authenticated'));

            state.listener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
            expect(getGameRewardAuthorityState()).toBe('authenticated');
        } finally {
            stop();
        }
    });

    it('実SIGNED_OUTイベントはanonymous遷移前に保留キューの匿名回収を抑止する', async () => {
        const stop = startAuthSessionListener();
        try {
            state.listener?.('SIGNED_OUT', null);
            await vi.waitFor(() => expect(getGameRewardAuthorityState()).toBe('anonymous'));
            expect(consumeAnonymousRecoverySuppression()).toBe(true);
        } finally {
            stop();
        }
    });

    it('登録後にセッションが無い時は確認メール待ちを返す', async () => {
        await expect(signUpWithEmail('new@example.com', 'secret1')).resolves.toEqual({ ok: true, emailVerificationPending: true });
        expect(state.signUp).toHaveBeenCalledWith(expect.objectContaining({
            email: 'new@example.com',
            password: 'secret1',
            options: expect.objectContaining({ emailRedirectTo: 'lifequest://settings?auth=verify' }),
        }));
    });

    it('再設定と確認メールでは同じアドレスを使い、アプリスキームへ戻す', async () => {
        await requestPasswordReset('person@example.com');
        await resendEmailVerification('person@example.com');
        expect(state.resetPasswordForEmail).toHaveBeenCalledWith('person@example.com', { redirectTo: 'lifequest://settings?auth=recovery' });
        expect(state.resend).toHaveBeenCalledWith(expect.objectContaining({ type: 'signup', email: 'person@example.com' }));
    });

    it('確認メール再送はSupabaseエラー時も同じ中立的な応答を返す', async () => {
        state.resend.mockResolvedValueOnce({ error: new Error('User not found') } as never);
        await expect(resendEmailVerification('unknown@example.com')).resolves.toEqual({ ok: true });
    });

    it('Google OAuthはPKCE callbackを指定してブラウザを開き、認証イベントへ同期開始を委譲する', async () => {
        await expect(signInWithGoogle()).resolves.toEqual({ ok: true });
        expect(state.signInWithOAuth).toHaveBeenCalledWith({
            provider: 'google',
            options: { redirectTo: 'lifequest://auth/callback', skipBrowserRedirect: true },
        });
        expect(state.openAuthSessionAsync).toHaveBeenCalledWith('https://accounts.google.com/example', 'lifequest://auth/callback');
        expect(state.exchangeCodeForSession).toHaveBeenCalledWith('google-code');
        expect(state.notifyLogin).not.toHaveBeenCalled();
    });

    it('Google OAuth callbackは専用パスのcodeだけを一度交換し、同じ結果を返す', async () => {
        const url = 'lifequest://auth/callback?code=one-time-google-code';
        await expect(handleMobileGoogleOAuthCallbackUrl(url)).resolves.toEqual({ ok: true });
        await expect(handleMobileGoogleOAuthCallbackUrl(`${url}&repeat=1`)).resolves.toEqual({ ok: true });
        expect(state.exchangeCodeForSession).toHaveBeenCalledTimes(1);
        expect(state.exchangeCodeForSession).toHaveBeenCalledWith('one-time-google-code');
    });

    it('Google OAuth callbackは成功後の遅延duplicateで使用済みcodeを再交換しない', async () => {
        const url = 'lifequest://auth/callback?code=completed-google-code';
        await expect(handleMobileGoogleOAuthCallbackUrl(url)).resolves.toEqual({ ok: true });
        await expect(handleMobileGoogleOAuthCallbackUrl(`${url}&source=late-linking`)).resolves.toEqual({ ok: true });
        expect(state.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    });

    it('Google OAuthのブラウザ復帰とLinking callbackが並行しても一度だけ交換し、両方成功する', async () => {
        let resolveExchange!: (value: { data: { session: { user: { id: string } } }; error: null }) => void;
        const exchangePromise = new Promise<{ data: { session: { user: { id: string } } }; error: null }>((resolve) => {
            resolveExchange = resolve;
        });
        state.exchangeCodeForSession.mockImplementationOnce(() => exchangePromise);
        const url = 'lifequest://auth/callback?code=parallel-google-code';
        const browserResult = handleMobileGoogleOAuthCallbackUrl(url);
        const linkingResult = handleMobileGoogleOAuthCallbackUrl(`${url}&source=linking`);
        expect(state.exchangeCodeForSession).toHaveBeenCalledTimes(1);
        resolveExchange({ data: { session: { user: { id: 'user-1' } } }, error: null });
        await expect(browserResult).resolves.toEqual({ ok: true });
        await expect(linkingResult).resolves.toEqual({ ok: true });
    });

    it('Google OAuth callbackは交換失敗後に同じcodeを再試行できる', async () => {
        const url = 'lifequest://auth/callback?code=retry-google-code';
        state.exchangeCodeForSession
            .mockResolvedValueOnce({ data: { session: null }, error: new Error('temporary failure') } as never)
            .mockResolvedValueOnce({ data: { session: { user: { id: 'user-1' } } }, error: null } as never);
        await expect(handleMobileGoogleOAuthCallbackUrl(url)).resolves.toMatchObject({ ok: false });
        await expect(handleMobileGoogleOAuthCallbackUrl(url)).resolves.toEqual({ ok: true });
        expect(state.exchangeCodeForSession).toHaveBeenCalledTimes(2);
    });

    it('Google OAuth callbackは交換例外後に同じcodeを再試行できる', async () => {
        const url = 'lifequest://auth/callback?code=throwing-google-code';
        state.exchangeCodeForSession
            .mockRejectedValueOnce(new Error('network failure'))
            .mockResolvedValueOnce({ data: { session: { user: { id: 'user-1' } } }, error: null } as never);
        await expect(handleMobileGoogleOAuthCallbackUrl(url)).resolves.toMatchObject({ ok: false });
        await expect(handleMobileGoogleOAuthCallbackUrl(url)).resolves.toEqual({ ok: true });
        expect(state.exchangeCodeForSession).toHaveBeenCalledTimes(2);
    });

    it('Google OAuth callbackはtoken、provider error、別scheme/pathを拒否する', async () => {
        await handleMobileGoogleOAuthCallbackUrl('lifequest://auth/callback?access_token=token');
        await handleMobileGoogleOAuthCallbackUrl('lifequest://auth/callback?error=access_denied');
        await handleMobileGoogleOAuthCallbackUrl('lifequest://settings?code=wrong-path');
        await handleMobileGoogleOAuthCallbackUrl('other://auth/callback?code=wrong-scheme');
        expect(state.exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it('Google OAuthのブラウザキャンセルは安全な結果として返す', async () => {
        state.openAuthSessionAsync.mockResolvedValueOnce({ type: 'cancel', url: '' });
        await expect(signInWithGoogle()).resolves.toEqual({ ok: false, message: 'Googleログインをキャンセルしました。' });
        expect(state.exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it('復旧リンクのcodeをセッションへ交換した後にだけパスワードを更新する', async () => {
        await handleMobilePasswordRecoveryUrl('lifequest://settings?code=recovery-code&type=recovery&auth=recovery');
        expect(state.exchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
        expect(getPasswordRecoveryState()).toBe('ready');
        const stop = startAuthSessionListener();
        state.listener?.('SIGNED_IN', { user: { id: 'user-1' } });
        expect(getGameRewardAuthorityState()).toBe('resolving');
        await expect(updatePasswordFromRecovery('secret1')).resolves.toEqual({ ok: true });
        expect(state.updateUser).toHaveBeenCalledWith({ password: 'secret1' });
        expect(getGameRewardAuthorityState()).toBe('authenticated');
        stop();
    });

    it('無効なスキーム・パス、またはURL内Bearer tokenはセッション交換しない', async () => {
        await handleMobilePasswordRecoveryUrl('other://settings?code=bad&type=recovery&auth=recovery');
        await handleMobilePasswordRecoveryUrl('lifequest://other?code=bad&type=recovery&auth=recovery');
        await handleMobilePasswordRecoveryUrl('lifequest://settings?type=recovery&auth=recovery&access_token=token&refresh_token=refresh');
        expect(state.exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it('確認済みメールのPKCE callbackは交換し、復旧ゲートを有効化しない', async () => {
        await handleMobileAuthCallbackUrl('lifequest://settings?code=verify-code&type=signup&auth=verify');
        expect(state.exchangeCodeForSession).toHaveBeenCalledWith('verify-code');
        expect(getPasswordRecoveryState()).toBe('idle');
    });

    it('確認callbackでも型や遷移先が一致しなければ交換しない', async () => {
        await handleMobileAuthCallbackUrl('lifequest://settings?code=bad&type=recovery&auth=verify');
        await handleMobileAuthCallbackUrl('lifequest://settings/extra?code=bad&type=signup&auth=verify');
        expect(state.exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it('同じPKCE URLは一度だけ交換する', async () => {
        const url = 'lifequest://settings?code=one-time-code&type=recovery&auth=recovery';
        await handleMobilePasswordRecoveryUrl(url);
        await handleMobilePasswordRecoveryUrl(url);
        expect(state.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    });

    it('永続された復旧ゲートは再起動時の初期セッションを通常ログインとして処理しない', async () => {
        state.recoveryGate = '1';
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', { user: { id: 'user-1' } });
            await vi.waitFor(() => expect(getPasswordRecoveryState()).toBe('ready'));
            expect(getGameRewardAuthorityState()).toBe('resolving');
        } finally {
            stop();
        }
    });

    it('復旧のキャンセルはsignOut成功後だけゲートを解除し、失敗時は状態を維持する', async () => {
        await handleMobilePasswordRecoveryUrl('lifequest://settings?code=cancel-code&type=recovery&auth=recovery');
        state.signOut.mockResolvedValueOnce({ error: new Error('offline') } as never);
        await expect(cancelPasswordRecovery()).resolves.toMatchObject({ ok: false });
        expect(getPasswordRecoveryState()).toBe('ready');
        await expect(cancelPasswordRecovery()).resolves.toEqual({ ok: true });
        expect(getPasswordRecoveryState()).toBe('idle');
        expect(state.recoveryGate).toBeNull();
    });

    it('復旧ゲートを書き込めない時はPKCEコードを交換しない', async () => {
        state.storageWriteError = true;
        await handleMobileAuthCallbackUrl('lifequest://settings?code=write-failure&type=recovery&auth=recovery');
        expect(state.exchangeCodeForSession).not.toHaveBeenCalled();
        expect(getPasswordRecoveryState()).toBe('invalid');
    });

    it('復旧ゲートを読み込めない時は初期セッションをfail-closedで停止する', async () => {
        state.storageReadError = true;
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', { user: { id: 'user-1' } });
            await vi.waitFor(() => expect(getPasswordRecoveryState()).toBe('invalid'));
            expect(getGameRewardAuthorityState()).toBe('resolving');
            expect(state.notifyLogin).not.toHaveBeenCalled();
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
