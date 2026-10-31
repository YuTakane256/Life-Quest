import { createClientDiagnosticLogArgs } from '@life-quest/core/diagnostics';
/**
 * Webの認証サービス（#503、メール認証のみ）。
 *
 * - サインアップ/ログイン/ログアウトとセッション復元
 * - セッション確立時に notifyLogin、ログアウト時に notifyLogout（core authLifecycle）
 * - ログアウトは notifyLogout の全フック完了を待ってから解決する（ADR-009:
 *   ストアのメモリ即時クリアがログアウトAPIの一部として完了する契約）
 */
import { captureAuthSessionScope, notifyLogin, notifyLogout, notifyTokenRefreshed } from '@life-quest/core/authLifecycle';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import type { BattleAuthState } from '@life-quest/core/battleStartPolicy';
import { getWebSupabaseClient } from './supabase';
import { detachPendingWebRewardOperations, restorePendingWebRewardOperations } from './pendingRewardOperations';
import { getWebEdgeFunctionInvoker } from './edgeFunctions';
import { cleanupDeletedWebAccount } from './accountDeletion';
import { flushCompletionRewardWrites } from './completionRewards';
import { hasPersistedCloudGame, prepareWebAnonymousSession } from './authStores';
import { createAccountDeletionOperation, type AccountDeletionApproval, type AccountDeletionResult, type SubscribeAccountDeletionIdentity } from '@life-quest/core/accountDeletion';

export type AuthResult =
    | { ok: true; emailVerificationPending?: boolean; manualAppleRevocationRequired?: boolean }
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
let recoveryGeneration = 0;
let recoveryTeardown: Promise<void> = Promise.resolve();

function pauseWebCloudForRecovery(): Promise<void> {
    setGameRewardAuthorityState('resolving');
    setPasswordRecoveryState('idle');
    detachPendingWebRewardOperations();
    const stopping = captureAuthSessionScope().userId !== null ? notifyLogout() : Promise.resolve();
    recoveryTeardown = Promise.all([recoveryTeardown, stopping]).then(() => undefined);
    return recoveryTeardown;
}
const webRecoveryGateKey = 'life-quest:auth:recovery-pending:v1';
const processedWebGoogleOAuthCodes = new Set<string>();
type GoogleOAuthState = { status: 'idle' } | { status: 'success' } | { status: 'error'; message: string };
let googleOAuthState: GoogleOAuthState = { status: 'idle' };
const googleOAuthListeners = new Set<(state: GoogleOAuthState) => void>();
const processedWebAppleOAuthCodes = new Set<string>();
type AppleOAuthState = { status: 'idle' } | { status: 'success' } | { status: 'error'; message: string };
let appleOAuthState: AppleOAuthState = { status: 'idle' };
const appleOAuthListeners = new Set<(state: AppleOAuthState) => void>();

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

function setGoogleOAuthState(state: GoogleOAuthState): void {
    googleOAuthState = state;
    googleOAuthListeners.forEach((listener) => listener(state));
}

export function getGoogleOAuthState(): GoogleOAuthState {
    return googleOAuthState;
}

export function clearGoogleOAuthState(): void {
    setGoogleOAuthState({ status: 'idle' });
}

export function subscribeGoogleOAuthState(listener: (state: GoogleOAuthState) => void): () => void {
    googleOAuthListeners.add(listener);
    return () => googleOAuthListeners.delete(listener);
}

function setAppleOAuthState(state: AppleOAuthState): void {
    appleOAuthState = state;
    appleOAuthListeners.forEach((listener) => listener(state));
}

export function getAppleOAuthState(): AppleOAuthState {
    return appleOAuthState;
}

export function clearAppleOAuthState(): void {
    setAppleOAuthState({ status: 'idle' });
}

export function subscribeAppleOAuthState(listener: (state: AppleOAuthState) => void): () => void {
    appleOAuthListeners.add(listener);
    return () => appleOAuthListeners.delete(listener);
}

function notConfigured(): AuthResult {
    return { ok: false, message: 'Supabaseが未設定です（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）' };
}

function hasWebRecoveryGate(): boolean {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(webRecoveryGateKey) === '1'; }
    catch { return true; } // Unknown persisted recovery state must not start cloud work.
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
        await flushCompletionRewardWrites();
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
        await flushCompletionRewardWrites();
        setGameRewardAuthorityState('authenticated');
    }
    return { ok: true };
}

function webAuthRedirectUrl(kind: 'recovery' | 'verify' | 'oauth' | 'apple-oauth'): string {
    return `${window.location.origin}/settings?auth=${kind}`;
}

/** Starts the browser-only Google OAuth flow. Session lifecycle remains onAuthStateChange-owned. */
export async function signInWithGoogle(): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    setGoogleOAuthState({ status: 'idle' });
    const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: webAuthRedirectUrl('oauth') },
    });
    if (error) {
        const message = '操作を完了できませんでした。入力内容と接続を確認して、時間をおいてもう一度お試しください。';
        setGoogleOAuthState({ status: 'error', message });
        return { ok: false, message };
    }
    return { ok: true };
}

/** Starts the browser-only Apple OAuth flow. Session lifecycle remains onAuthStateChange-owned. */
export async function signInWithApple(): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    setAppleOAuthState({ status: 'idle' });
    const { error } = await client.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: webAuthRedirectUrl('apple-oauth') },
    });
    if (error) {
        const message = 'Appleでログインを完了できませんでした。もう一度お試しください。';
        setAppleOAuthState({ status: 'error', message });
        return { ok: false, message };
    }
    return { ok: true };
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
    const generation = recoveryGeneration;
    const current = () => generation === recoveryGeneration;
    await recoveryTeardown;
    if (!current() || passwordRecoveryState !== 'ready') return genericAuthFailure();
    const before = await client.auth.getSession();
    if (!current() || before.error || !before.data.session) return genericAuthFailure();
    const owner = before.data.session.user.id;
    const { error } = await client.auth.updateUser({ password });
    if (!current()) return genericAuthFailure();
    if (error) {
        setPasswordRecoveryState('invalid');
        return { ok: false, message: 'このリンクは無効または期限切れです。パスワードを再設定してください。' };
    }
    const { data, error: sessionError } = await client.auth.getSession();
    if (!current() || sessionError || data.session?.user.id !== owner) return genericAuthFailure();
    try { setWebRecoveryGate(false); }
    catch { setPasswordRecoveryState('invalid'); return genericAuthFailure(); }
    setPasswordRecoveryState('idle');
    if (data.session) {
        setGameRewardAuthorityState('resolving');
        try { restorePendingWebRewardOperations(data.session.user.id); } catch { /* メモリ保留は維持する */ }
        await notifyLogin(data.session.user.id);
        await flushCompletionRewardWrites();
        if (!current()) return genericAuthFailure();
        setGameRewardAuthorityState('authenticated');
    }
    return { ok: true };
}

/** Cancel only the local recovery session; it has not started cloud sync yet. */
export async function cancelPasswordRecovery(): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    const generation = ++recoveryGeneration;
    await recoveryTeardown;
    if (generation !== recoveryGeneration) return genericAuthFailure();
    suppressRecoverySignOut = true;
    try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (generation !== recoveryGeneration) return genericAuthFailure();
        if (error) return { ok: false, message: 'ログアウトを完了できませんでした。接続を確認してもう一度お試しください。' };
        detachPendingWebRewardOperations();
        await notifyLogout();
        if (generation !== recoveryGeneration) return genericAuthFailure();
        setWebRecoveryGate(false);
        setPasswordRecoveryState('idle');
        setGameRewardAuthorityState('anonymous');
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

function isWebGoogleOAuthCallbackUrl(): boolean {
    const url = new URL(window.location.href);
    return url.pathname === '/settings' && url.searchParams.get('auth') === 'oauth';
}

function scrubWebGoogleOAuthUrl(): void {
    window.history.replaceState(null, '', window.location.pathname);
}

function isWebAppleOAuthCallbackUrl(): boolean {
    const url = new URL(window.location.href);
    return url.pathname === '/settings' && url.searchParams.get('auth') === 'apple-oauth';
}

function scrubWebAppleOAuthUrl(): void {
    window.history.replaceState(null, '', window.location.pathname);
}

/**
 * Consume only our explicit Google PKCE callback. This intentionally does not
 * call notifyLogin: the normal Supabase auth-state listener owns that work.
 */
export async function handleWebGoogleOAuthCallback(): Promise<void> {
    if (typeof window === 'undefined' || !isWebGoogleOAuthCallbackUrl()) return;
    const client = getWebSupabaseClient();
    if (!client) return;
    const callbackUrl = window.location.href;
    const url = new URL(callbackUrl);
    const query = url.searchParams;
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    try {
        if (query.has('access_token') || query.has('refresh_token') || fragment.has('access_token') || fragment.has('refresh_token')) {
            setGoogleOAuthState({ status: 'error', message: 'Googleでログインできませんでした。もう一度お試しください。' });
            return;
        }
        if (query.has('error') || query.has('error_code')) {
            setGoogleOAuthState({ status: 'error', message: 'Googleでログインを完了できませんでした。もう一度お試しください。' });
            return;
        }
        const code = query.get('code');
        if (!code || processedWebGoogleOAuthCodes.has(code)) return;
        processedWebGoogleOAuthCodes.add(code);
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) setGoogleOAuthState({ status: 'error', message: 'Googleでログインを完了できませんでした。もう一度お試しください。' });
        else setGoogleOAuthState({ status: 'success' });
    } catch {
        setGoogleOAuthState({ status: 'error', message: 'Googleでログインを完了できませんでした。もう一度お試しください。' });
    } finally {
        // Authorization codes and provider errors must never remain in browser history.
        scrubWebGoogleOAuthUrl();
    }
}

/** Consume only our explicit Apple PKCE callback. Auth-state events own sync startup. */
export async function handleWebAppleOAuthCallback(): Promise<void> {
    if (typeof window === 'undefined' || !isWebAppleOAuthCallbackUrl()) return;
    const client = getWebSupabaseClient();
    if (!client) return;
    const url = new URL(window.location.href);
    const query = url.searchParams;
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    try {
        if (query.has('access_token') || query.has('refresh_token') || fragment.has('access_token') || fragment.has('refresh_token')) {
            setAppleOAuthState({ status: 'error', message: 'Appleでログインできませんでした。もう一度お試しください。' });
            return;
        }
        if (query.has('error') || query.has('error_code')) {
            setAppleOAuthState({ status: 'error', message: 'Appleでログインを完了できませんでした。もう一度お試しください。' });
            return;
        }
        const code = query.get('code');
        if (!code || processedWebAppleOAuthCodes.has(code)) return;
        processedWebAppleOAuthCodes.add(code);
        const { data, error } = await client.auth.exchangeCodeForSession(code);
        if (error) {
            setAppleOAuthState({ status: 'error', message: 'Appleでログインを完了できませんでした。もう一度お試しください。' });
        } else {
            // Supabase supplies this only for the just-completed provider flow.
            // Forward it once to the server; it is never written by app code.
            const providerRefreshToken = data.session?.provider_refresh_token;
            const invoke = getWebEdgeFunctionInvoker();
            if (!providerRefreshToken || !invoke) {
                await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
                setAppleOAuthState({ status: 'error', message: 'Appleログインの安全設定を完了できませんでした。もう一度お試しください。' });
            } else {
                try {
                    await invoke('record_apple_refresh_token', { refresh_token: providerRefreshToken });
                    // Replace the in-memory OAuth session too. The storage adapter
                    // already removes provider tokens from persistent localStorage.
                    await client.auth.refreshSession();
                    setAppleOAuthState({ status: 'success' });
                } catch {
                    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
                    setAppleOAuthState({ status: 'error', message: 'Appleログインの安全設定を完了できませんでした。もう一度お試しください。' });
                }
            }
        }
    } catch {
        setAppleOAuthState({ status: 'error', message: 'Appleでログインを完了できませんでした。もう一度お試しください。' });
    } finally {
        scrubWebAppleOAuthUrl();
    }
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
    await flushCompletionRewardWrites();
    setWebRecoveryGate(false);
    setGameRewardAuthorityState('anonymous');
    return { ok: true };
}

/**
 * 現在のアカウントを物理削除する。Edge Functionの成功前は端末データにも
 * セッションにも触れない。userIdはJWTからサーバーが決定する。
 */
export async function deleteCurrentAccount(approval: AccountDeletionApproval): Promise<AccountDeletionResult> {
    const client = getWebSupabaseClient();
    const invoke = getWebEdgeFunctionInvoker();
    if (!client || !invoke) return notConfigured();
    return deleteAccountOperation(approval);
}

/** Watch SDK identity synchronously; normal lifecycle initialization may still be pending. */
export const subscribeAccountDeletionIdentity: SubscribeAccountDeletionIdentity = (listener) => {
    const client = getWebSupabaseClient();
    if (!client) return () => {};
    const { data } = client.auth.onAuthStateChange((_event, session) => listener(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
};

const deleteAccountOperation = createAccountDeletionOperation({
    subscribeSessionIdentity: subscribeAccountDeletionIdentity,
    getSessionUserId: async () => { const { data, error } = await getWebSupabaseClient()!.auth.getSession(); if (error) throw error; return data.session?.user.id ?? null; },
    invokeDelete: (options) => getWebEdgeFunctionInvoker()!('delete_account', {}, options),
    detachRewards: detachPendingWebRewardOperations,
    cleanup: cleanupDeletedWebAccount,
    signOut: async () => { const { error } = await getWebSupabaseClient()!.auth.signOut({ scope: 'local' }); if (error) throw error; },
    setAnonymous: () => setGameRewardAuthorityState('anonymous'),
});

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
    recoveryGeneration += 1;
    setPasswordRecoveryState('idle');
    let sessionGeneration = 0;
    const finishAnonymous = () => {
        const generation = ++sessionGeneration;
        const current = () => generation === sessionGeneration;
        // Even a local canonical seed may still be waiting for the game lock.
        // Settle it before changing reward generation or deciding the saved scope.
        void flushCompletionRewardWrites().then(async () => {
            if (!current()) return;
            if (hasPersistedCloudGame()) {
                setGameRewardAuthorityState('resolving');
                await prepareWebAnonymousSession(current);
            }
            if (current()) setGameRewardAuthorityState('anonymous');
        }).catch((error) => console.warn(...createClientDiagnosticLogArgs('anonymous_session_prepare_failed', error)));
    };
    const client = getWebSupabaseClient();
    if (!client) {
        finishAnonymous();
        return () => { sessionGeneration += 1; };
    }
    recoveryCallbackInProgress = isRecoveryCallbackUrl() || hasWebRecoveryGate();
    if (recoveryCallbackInProgress) void pauseWebCloudForRecovery();
    if (isRecoveryCallbackUrl()) {
        try { setWebRecoveryGate(true); }
        catch { setPasswordRecoveryState('invalid'); }
    }
    if (hasRecoveryFailureInUrl()) {
        recoveryCallbackInProgress = false;
        setPasswordRecoveryState('invalid');
        scrubRecoveryUrl();
    }
    setGameRewardAuthorityState('resolving');
    const { data } = client.auth.onAuthStateChange((event, session) => {
        // Invalidate an older no-session recovery before a new login can seed stores.
        if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY')) {
            sessionGeneration += 1;
            recoveryGeneration += 1;
        }
        if (event === 'PASSWORD_RECOVERY' && session) {
            recoveryCallbackInProgress = false;
            const generation = recoveryGeneration;
            const stopped = pauseWebCloudForRecovery();
            try { setWebRecoveryGate(true); }
            catch { setPasswordRecoveryState('invalid'); scrubRecoveryUrl(); return; }
            void stopped.then(() => {
                if (generation === recoveryGeneration) setPasswordRecoveryState('ready');
            });
            scrubRecoveryUrl();
            return;
        }
        if (event === 'TOKEN_REFRESHED' && session) {
            if (!recoveryCallbackInProgress && !hasWebRecoveryGate() && passwordRecoveryState !== 'ready') {
                void notifyTokenRefreshed(session.user.id);
            }
            return;
        }
        if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
            // Recovery sessions can emit SIGNED_IN before PASSWORD_RECOVERY.
            // They must not start migration/sync until the password is updated.
            if (recoveryCallbackInProgress || hasWebRecoveryGate() || passwordRecoveryState === 'ready') {
                const invalid = passwordRecoveryState === 'invalid';
                const generation = recoveryGeneration;
                const stopped = pauseWebCloudForRecovery();
                try { setWebRecoveryGate(true); }
                catch { setPasswordRecoveryState('invalid'); return; }
                void stopped.then(() => {
                    if (generation === recoveryGeneration && !invalid) setPasswordRecoveryState('ready');
                });
                if (invalid) setPasswordRecoveryState('invalid');
                return;
            }
            setGameRewardAuthorityState('resolving');
            try { restorePendingWebRewardOperations(session.user.id); } catch { /* メモリ保留は維持する */ }
            const generation = sessionGeneration;
            void notifyLogin(session.user.id).then(async () => {
                await flushCompletionRewardWrites();
                if (generation === sessionGeneration) setGameRewardAuthorityState('authenticated');
            });
        }
        if (event === 'INITIAL_SESSION' && !session) {
            if (hasWebRecoveryGate()) {
                setPasswordRecoveryState('invalid');
                return;
            }
            detachPendingWebRewardOperations();
            finishAnonymous();
        }
        if (event === 'SIGNED_OUT') {
            if (suppressRecoverySignOut) return;
            recoveryGeneration += 1;
            if (hasWebRecoveryGate() || passwordRecoveryState === 'ready') setPasswordRecoveryState('invalid');
            sessionGeneration += 1;
            // authenticatedの保留操作をanonymous報酬として消費させない。
            // 永続キーは残し、同一userの次回ログインでのみ復元する。
            detachPendingWebRewardOperations();
            if (hasPersistedCloudGame()) {
                setGameRewardAuthorityState('resolving');
                const generation = sessionGeneration;
                void notifyLogout().then(() => {
                    if (generation === sessionGeneration) finishAnonymous();
                });
            } else {
                setGameRewardAuthorityState('anonymous');
                void notifyLogout();
            }
        }
    });
    void handleWebGoogleOAuthCallback();
    void handleWebAppleOAuthCallback();
    return () => { sessionGeneration += 1; recoveryGeneration += 1; data.subscription.unsubscribe(); };
}
