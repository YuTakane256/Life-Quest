/**
 * Webの認証サービス（#503、メール認証のみ）。
 *
 * - サインアップ/ログイン/ログアウトとセッション復元
 * - セッション確立時に notifyLogin、ログアウト時に notifyLogout（core authLifecycle）
 * - ログアウトは notifyLogout の全フック完了を待ってから解決する（ADR-009:
 *   ストアのメモリ即時クリアがログアウトAPIの一部として完了する契約）
 */
import { notifyLogin, notifyLogout } from '@life-quest/core/authLifecycle';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import type { BattleAuthState } from '@life-quest/core/battleStartPolicy';
import { getWebSupabaseClient } from './supabase';
import { detachPendingWebRewardOperations, restorePendingWebRewardOperations } from './pendingRewardOperations';
import { getWebEdgeFunctionInvoker } from './edgeFunctions';
import { cleanupDeletedWebAccount } from './accountDeletion';

export type AuthResult =
    | { ok: true; emailVerificationPending?: boolean }
    | { ok: false; message: string };

export interface AuthUserInfo {
    userId: string;
    email: string | null;
}

export type PasswordRecoveryState = 'idle' | 'ready' | 'invalid';

let passwordRecoveryState: PasswordRecoveryState = 'idle';
const passwordRecoveryListeners = new Set<(state: PasswordRecoveryState) => void>();
let recoveryCallbackInProgress = false;
let suppressRecoverySignOut = false;
const webRecoveryGateKey = 'life-quest:auth:recovery-pending:v1';

function setPasswordRecoveryState(state: PasswordRecoveryState): void {
    passwordRecoveryState = state;
    passwordRecoveryListeners.forEach((listener) => listener(state));
}

export function getPasswordRecoveryState(): PasswordRecoveryState {
    return passwordRecoveryState;
}

export function clearPasswordRecoveryState(): void {
    setPasswordRecoveryState('idle');
}

export function subscribePasswordRecoveryState(listener: (state: PasswordRecoveryState) => void): () => void {
    passwordRecoveryListeners.add(listener);
    return () => passwordRecoveryListeners.delete(listener);
}

function notConfigured(): AuthResult {
    return { ok: false, message: 'Supabaseが未設定です（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）' };
}

function hasWebRecoveryGate(): boolean {
    return typeof window !== 'undefined' && window.localStorage.getItem(webRecoveryGateKey) === '1';
}

function setWebRecoveryGate(pending: boolean): void {
    if (typeof window === 'undefined') return;
    if (pending) window.localStorage.setItem(webRecoveryGateKey, '1');
    else window.localStorage.removeItem(webRecoveryGateKey);
}

function genericAuthFailure(): AuthResult {
    return { ok: false, message: '操作を完了できませんでした。入力内容と接続を確認して、時間をおいてもう一度お試しください。' };
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: webAuthRedirectUrl('verify') } });
    if (error) return genericAuthFailure();
    if (data.session && data.user) {
        setGameRewardAuthorityState('resolving');
        try { restorePendingWebRewardOperations(data.user.id); } catch { /* メモリ保留は維持する */ }
        await notifyLogin(data.user.id);
        setGameRewardAuthorityState('authenticated');
    }
    // Email confirmation is enabled when Supabase returns a user without a session.
    // Keep this deliberately generic so this response cannot be used for enumeration.
    return { ok: true, emailVerificationPending: Boolean(data.user && !data.session) };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return genericAuthFailure();
    if (data.user) {
        setGameRewardAuthorityState('resolving');
        try { restorePendingWebRewardOperations(data.user.id); } catch { /* メモリ保留は維持する */ }
        await notifyLogin(data.user.id);
        setGameRewardAuthorityState('authenticated');
    }
    return { ok: true };
}

function webAuthRedirectUrl(kind: 'recovery' | 'verify'): string {
    return `${window.location.origin}/settings?auth=${kind}`;
}

/**
 * Always return the same visible outcome for a submitted address. Supabase itself
 * also avoids exposing account existence for this operation.
 */
export async function requestPasswordReset(email: string): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: webAuthRedirectUrl('recovery'),
    });
    if (error) return { ok: false, message: 'メールを送信できませんでした。時間をおいてもう一度お試しください。' };
    return { ok: true };
}

/** Request another verification email without exposing whether the account exists. */
export async function resendEmailVerification(email: string): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    try {
        await client.auth.resend({
            type: 'signup',
            email,
            options: { emailRedirectTo: webAuthRedirectUrl('verify') },
        });
    } catch {
        // Deliberately indistinguishable from a successful request.
    }
    // Deliberately neutral: this response must not reveal account or delivery state.
    return { ok: true };
}

/** Password changes from this form are allowed only after a recovery-link session. */
export async function updatePasswordFromRecovery(password: string): Promise<AuthResult> {
    if (passwordRecoveryState !== 'ready' || !hasWebRecoveryGate()) {
        return { ok: false, message: 'このリンクは無効または期限切れです。パスワードを再設定してください。' };
    }
    if (password.length < 6) return { ok: false, message: 'パスワードは6文字以上で入力してください。' };
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    const { error } = await client.auth.updateUser({ password });
    if (error) {
        setPasswordRecoveryState('invalid');
        return { ok: false, message: 'このリンクは無効または期限切れです。パスワードを再設定してください。' };
    }
    setWebRecoveryGate(false);
    setPasswordRecoveryState('idle');
    const { data } = await client.auth.getSession();
    if (data.session) {
        setGameRewardAuthorityState('resolving');
        try { restorePendingWebRewardOperations(data.session.user.id); } catch { /* メモリ保留は維持する */ }
        await notifyLogin(data.session.user.id);
        setGameRewardAuthorityState('authenticated');
    }
    return { ok: true };
}

/** Cancel only the local recovery session; it has not started cloud sync yet. */
export async function cancelPasswordRecovery(): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    suppressRecoverySignOut = true;
    try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) return { ok: false, message: 'ログアウトを完了できませんでした。接続を確認してもう一度お試しください。' };
        detachPendingWebRewardOperations();
        await notifyLogout();
        setGameRewardAuthorityState('anonymous');
        setWebRecoveryGate(false);
        setPasswordRecoveryState('idle');
        return { ok: true };
    } catch {
        return { ok: false, message: 'ログアウトを完了できませんでした。接続を確認してもう一度お試しください。' };
    } finally {
        suppressRecoverySignOut = false;
    }
}

function hasRecoveryFailureInUrl(): boolean {
    const url = new URL(window.location.href);
    const query = url.searchParams;
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    const isRecovery = query.get('auth') === 'recovery' || query.get('type') === 'recovery' || fragment.get('type') === 'recovery';
    return isRecovery && (query.has('error') || fragment.has('error') || query.has('error_code') || fragment.has('error_code'));
}

function isRecoveryCallbackUrl(): boolean {
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    return url.searchParams.get('auth') === 'recovery' ||
        url.searchParams.get('type') === 'recovery' ||
        fragment.get('type') === 'recovery';
}

function scrubRecoveryUrl(): void {
    if (!isRecoveryCallbackUrl()) return;
    // Recovery callbacks can carry a PKCE code or implicit-flow fragments. Neither
    // should survive in browser history after Supabase has consumed the callback.
    window.history.replaceState(null, '', window.location.pathname);
}

export async function signOutUser(): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    const { error } = await client.auth.signOut();
    if (error) return genericAuthFailure();
    // ローカルデータ（quest-board-*）は保持する。ここではフック（同期停止・
    // クラウド対象ストアのメモリクリア）だけを完了させる。
    detachPendingWebRewardOperations();
    await notifyLogout();
    setWebRecoveryGate(false);
    setGameRewardAuthorityState('anonymous');
    return { ok: true };
}

/**
 * 現在のアカウントを物理削除する。Edge Functionの成功前は端末データにも
 * セッションにも触れない。userIdはJWTからサーバーが決定する。
 */
export async function deleteCurrentAccount(): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    const invoke = getWebEdgeFunctionInvoker();
    if (!client || !invoke) return notConfigured();
    const { data } = await client.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return { ok: false, message: 'ログインが必要です' };
    try {
        await invoke('delete_account');
    } catch {
        return { ok: false, message: '退会処理に失敗しました。データはそのまま保持されています。' };
    }
    let cleanupFailed = false;
    detachPendingWebRewardOperations();
    try { await cleanupDeletedWebAccount(userId); } catch { cleanupFailed = true; }
    // cleanup失敗時も削除済みアカウントのセッションは残さない。全工程を試みた後に必ず実行する。
    try { await client.auth.signOut({ scope: 'local' }); } catch { cleanupFailed = true; }
    try { await notifyLogout(); } catch { cleanupFailed = true; }
    setGameRewardAuthorityState('anonymous');
    return cleanupFailed
        ? { ok: false, message: 'アカウントは削除されました。一部の端末データを削除できませんでした。アプリを再起動してください。' }
        : { ok: true };
}

/** 現在のセッションのユーザー。未ログイン・未設定なら null。 */
export async function getCurrentUser(): Promise<AuthUserInfo | null> {
    const client = getWebSupabaseClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    if (!data.session) return null;
    return { userId: data.session.user.id, email: data.session.user.email ?? null };
}

/** バトル開始のため、操作時点のセッションを三値で確認する。 */
export async function getBattleAuthState(): Promise<BattleAuthState> {
    const client = getWebSupabaseClient();
    if (!client) return { kind: 'anonymous' };
    try {
        const { data, error } = await client.auth.getSession();
        if (error) return { kind: 'unavailable' };
        return data.session ? { kind: 'authenticated', userId: data.session.user.id } : { kind: 'anonymous' };
    } catch {
        return { kind: 'unavailable' };
    }
}

/** バトル以外のクラウド権威ゲーム操作でも使う操作時点の認証判定。 */
export const getGameAuthState = getBattleAuthState;

/**
 * アプリ起動時に呼ぶ。保存済みセッションが復元されたら notifyLogin を発火する。
 * 戻り値で購読解除できる。
 */
export function startAuthSessionListener(): () => void {
    const client = getWebSupabaseClient();
    if (!client) {
        setGameRewardAuthorityState('anonymous');
        return () => {};
    }
    recoveryCallbackInProgress = isRecoveryCallbackUrl() || hasWebRecoveryGate();
    if (isRecoveryCallbackUrl()) setWebRecoveryGate(true);
    if (hasRecoveryFailureInUrl()) {
        recoveryCallbackInProgress = false;
        setPasswordRecoveryState('invalid');
        scrubRecoveryUrl();
    }
    setGameRewardAuthorityState('resolving');
    const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session) {
            recoveryCallbackInProgress = false;
            setWebRecoveryGate(true);
            setPasswordRecoveryState('ready');
            scrubRecoveryUrl();
            return;
        }
        if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
            // Recovery sessions can emit SIGNED_IN before PASSWORD_RECOVERY.
            // They must not start migration/sync until the password is updated.
            if (recoveryCallbackInProgress || hasWebRecoveryGate() || passwordRecoveryState === 'ready') {
                if (hasWebRecoveryGate() && passwordRecoveryState === 'idle') setPasswordRecoveryState('ready');
                return;
            }
            setGameRewardAuthorityState('resolving');
            try { restorePendingWebRewardOperations(session.user.id); } catch { /* メモリ保留は維持する */ }
            void notifyLogin(session.user.id).then(() => setGameRewardAuthorityState('authenticated'));
        }
        if (event === 'INITIAL_SESSION' && !session) {
            if (hasWebRecoveryGate()) {
                setPasswordRecoveryState('invalid');
                return;
            }
            detachPendingWebRewardOperations();
            setGameRewardAuthorityState('anonymous');
        }
        if (event === 'SIGNED_OUT') {
            if (suppressRecoverySignOut) return;
            // authenticatedの保留操作をanonymous報酬として消費させない。
            // 永続キーは残し、同一userの次回ログインでのみ復元する。
            detachPendingWebRewardOperations();
            setGameRewardAuthorityState('anonymous');
            void notifyLogout();
        }
    });
    return () => data.subscription.unsubscribe();
}
