import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGameRewardAuthorityState, setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import {
    clearPendingWebRewardOperations,
    deferWebRewardOperation,
    getPendingWebRewardOperations,
    pendingWebRewardOperationsKey,
    restorePendingWebRewardOperations,
} from './pendingRewardOperations';

const state = vi.hoisted(() => ({
    listener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    resend: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: { url: 'https://accounts.google.com/example' }, error: null })),
    signUp: vi.fn(async () => ({ data: { user: { id: 'user-1' }, session: null }, error: null })),
    getSession: vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } } })),
    signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    notifyLogin: vi.fn(async () => undefined),
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
    notifyLogin: state.notifyLogin,
    notifyLogout: state.notifyLogout,
}));

import {
    getPasswordRecoveryState,
    requestPasswordReset,
    resendEmailVerification,
    cancelPasswordRecovery,
    clearPasswordRecoveryState,
    clearGoogleOAuthState,
    handleWebGoogleOAuthCallback,
    signUpWithEmail,
    signInWithGoogle,
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
        window.history.replaceState(null, '', '/settings');
        vi.clearAllMocks();
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

    it('PASSWORD_RECOVERYイベントの後にだけパスワードを更新する', async () => {
        await expect(updatePasswordFromRecovery('secret1')).resolves.toMatchObject({ ok: false });
        const stop = startAuthSessionListener();
        try {
            state.listener?.('PASSWORD_RECOVERY', { user: { id: 'user-1' } });
            expect(getPasswordRecoveryState()).toBe('ready');
            state.listener?.('SIGNED_IN', { user: { id: 'user-1' } });
            expect(getGameRewardAuthorityState()).toBe('resolving');
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

    it('永続された復旧ゲートは初期セッションを通常ログインとして処理しない', () => {
        localStorage.setItem('life-quest:auth:recovery-pending:v1', '1');
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', { user: { id: 'user-1' } });
            expect(getPasswordRecoveryState()).toBe('ready');
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
