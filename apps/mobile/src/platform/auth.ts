/**
 * Mobileの認証サービス（#503、メール認証のみ）。Webの src/platform/auth.ts と同型。
 */
import { notifyLogin, notifyLogout } from '@life-quest/core/authLifecycle';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import type { BattleAuthState } from '@life-quest/core/battleStartPolicy';
import { getMobileSupabaseClient } from './supabase';
import { detachPendingRewardOperations, restorePendingRewardOperations } from './pendingRewardOperations';
import { getMobileEdgeFunctionInvoker } from './edgeFunctions';
import { cleanupDeletedMobileAccount } from './accountDeletion';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
let recoveryGateHydrated = false;
let recoveryGateHydrationFailed = false;
let mobileRecoveryGate = false;
let deferredAuthEvent: { event: string; session: { user: { id: string } } | null } | null = null;
const processedRecoveryUrls = new Set<string>();
const mobileRecoveryGateKey = 'life-quest:auth:recovery-pending:v1';

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
    return { ok: false, message: 'Supabaseが未設定です（EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY)' };
}

function genericAuthFailure(): AuthResult {
    return { ok: false, message: '操作を完了できませんでした。入力内容と接続を確認して、時間をおいてもう一度お試しください。' };
}

async function persistMobileRecoveryGate(pending: boolean): Promise<boolean> {
    try {
        if (pending) await AsyncStorage.setItem(mobileRecoveryGateKey, '1');
        else await AsyncStorage.removeItem(mobileRecoveryGateKey);
        mobileRecoveryGate = pending;
        return true;
    } catch {
        return false;
    }
}

async function hydrateMobileRecoveryGate(): Promise<boolean> {
    try {
        mobileRecoveryGate = (await AsyncStorage.getItem(mobileRecoveryGateKey)) === '1';
        return true;
    } catch {
        recoveryGateHydrationFailed = true;
        return false;
    } finally {
        recoveryGateHydrated = true;
    }
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: mobileEmailVerificationRedirectUrl } });
    if (error) return genericAuthFailure();
    if (data.session && data.user) {
        setGameRewardAuthorityState('resolving');
        await restorePendingRewardOperations(data.user.id).catch(() => undefined);
        await notifyLogin(data.user.id);
        setGameRewardAuthorityState('authenticated');
    }
    return { ok: true, emailVerificationPending: Boolean(data.user && !data.session) };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return genericAuthFailure();
    if (data.user) {
        setGameRewardAuthorityState('resolving');
        await restorePendingRewardOperations(data.user.id).catch(() => undefined);
        await notifyLogin(data.user.id);
        setGameRewardAuthorityState('authenticated');
    }
    return { ok: true };
}

const mobilePasswordRecoveryRedirectUrl = 'lifequest://settings?auth=recovery';
const mobileEmailVerificationRedirectUrl = 'lifequest://settings?auth=verify';

/** The visible result is intentionally neutral so an address cannot be enumerated. */
export async function requestPasswordReset(email: string): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: mobilePasswordRecoveryRedirectUrl,
    });
    if (error) return { ok: false, message: 'メールを送信できませんでした。時間をおいてもう一度お試しください。' };
    return { ok: true };
}

export async function resendEmailVerification(email: string): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    try {
        await client.auth.resend({
            type: 'signup',
            email,
            options: { emailRedirectTo: mobileEmailVerificationRedirectUrl },
        });
    } catch {
        // Deliberately indistinguishable from a successful request.
    }
    // Deliberately neutral: this response must not reveal account or delivery state.
    return { ok: true };
}

export async function updatePasswordFromRecovery(password: string): Promise<AuthResult> {
    if (passwordRecoveryState !== 'ready' || !mobileRecoveryGate) {
        return { ok: false, message: 'このリンクは無効または期限切れです。パスワードを再設定してください。' };
    }
    if (password.length < 6) return { ok: false, message: 'パスワードは6文字以上で入力してください。' };
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    const { error } = await client.auth.updateUser({ password });
    if (error) {
        setPasswordRecoveryState('invalid');
        return { ok: false, message: 'このリンクは無効または期限切れです。パスワードを再設定してください。' };
    }
    if (!await persistMobileRecoveryGate(false)) {
        setPasswordRecoveryState('invalid');
        return genericAuthFailure();
    }
    setPasswordRecoveryState('idle');
    const { data } = await client.auth.getSession();
    if (data.session) {
        setGameRewardAuthorityState('resolving');
        await restorePendingRewardOperations(data.session.user.id).catch(() => undefined);
        await notifyLogin(data.session.user.id);
        setGameRewardAuthorityState('authenticated');
    }
    return { ok: true };
}

/** Cancel only the local recovery session; cloud sync has not started for it. */
export async function cancelPasswordRecovery(): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    suppressRecoverySignOut = true;
    try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) return { ok: false, message: 'ログアウトを完了できませんでした。接続を確認してもう一度お試しください。' };
        detachPendingRewardOperations({ suppressAnonymousRecovery: true });
        await notifyLogout();
        setGameRewardAuthorityState('anonymous');
        if (!await persistMobileRecoveryGate(false)) {
            setPasswordRecoveryState('invalid');
            return genericAuthFailure();
        }
        setPasswordRecoveryState('idle');
        return { ok: true };
    } catch {
        return { ok: false, message: 'ログアウトを完了できませんでした。接続を確認してもう一度お試しください。' };
    } finally {
        suppressRecoverySignOut = false;
    }
}

function readMobileRecoveryParams(url: string): { parsed: URL; params: URLSearchParams } {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    fragment.forEach((value, key) => {
        if (!params.has(key)) params.set(key, value);
    });
    return { parsed, params };
}

/**
 * Accept only the registered custom-scheme PKCE callback. Bearer tokens in a
 * custom URL are deliberately rejected to prevent session fixation.
 */
export async function handleMobileAuthCallbackUrl(url: string): Promise<void> {
    const client = getMobileSupabaseClient();
    if (!client) return;
    let callback: { parsed: URL; params: URLSearchParams };
    try {
        callback = readMobileRecoveryParams(url);
    } catch {
        return;
    }
    const { parsed, params } = callback;
    const isExpectedTarget = parsed.protocol === 'lifequest:' &&
        parsed.hostname === 'settings' &&
        (parsed.pathname === '' || parsed.pathname === '/');
    const mode = params.get('auth');
    const type = params.get('type');
    const isRecoveryCallback = isExpectedTarget && mode === 'recovery' && type === 'recovery';
    const isVerificationCallback = isExpectedTarget && mode === 'verify' && type === 'signup';
    if ((!isRecoveryCallback && !isVerificationCallback) || params.has('access_token') || params.has('refresh_token')) return;
    const code = params.get('code');
    if (!code || processedRecoveryUrls.has(url)) return;
    processedRecoveryUrls.add(url);
    try {
        if (isRecoveryCallback) {
            recoveryCallbackInProgress = true;
            if (!await persistMobileRecoveryGate(true)) {
                recoveryGateHydrationFailed = true;
                setPasswordRecoveryState('invalid');
                return;
            }
        }
        const result = await client.auth.exchangeCodeForSession(code);
        if (result?.error) {
            if (isRecoveryCallback) setPasswordRecoveryState('invalid');
        } else if (result?.data.session && isRecoveryCallback) {
            setPasswordRecoveryState('ready');
        }
    } catch {
        setPasswordRecoveryState('invalid');
    } finally {
        recoveryCallbackInProgress = false;
    }
}

/** @deprecated Use handleMobileAuthCallbackUrl; retained for the recovery-only caller contract. */
export const handleMobilePasswordRecoveryUrl = handleMobileAuthCallbackUrl;

/** Receive a cold-start or foreground recovery link without affecting normal URLs. */
export function startMobilePasswordRecoveryLinkListener(): () => void {
    void Linking.getInitialURL().then((url) => {
        if (url) void handleMobileAuthCallbackUrl(url);
    }).catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => {
        void handleMobileAuthCallbackUrl(url);
    });
    return () => subscription.remove();
}

export async function signOutUser(): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    const { error } = await client.auth.signOut();
    if (error) return genericAuthFailure();
    // ローカルデータ（quest-board-*）は保持する。フック（同期停止・ストアクリア）の
    // 完了を待ってから解決する（ADR-009）。
    detachPendingRewardOperations({ suppressAnonymousRecovery: true });
    await notifyLogout();
    if (!await persistMobileRecoveryGate(false)) {
        setPasswordRecoveryState('invalid');
        return genericAuthFailure();
    }
    setGameRewardAuthorityState('anonymous');
    return { ok: true };
}

/** 現在の認証アカウントを削除する。サーバー成功前にはローカル状態を変更しない。 */
export async function deleteCurrentAccount(): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    const invoke = getMobileEdgeFunctionInvoker();
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
    detachPendingRewardOperations({ suppressAnonymousRecovery: true });
    try { await cleanupDeletedMobileAccount(userId); } catch { cleanupFailed = true; }
    // cleanup失敗時も削除済みアカウントのセッションは残さない。全工程を試みた後に必ず実行する。
    try { await client.auth.signOut({ scope: 'local' }); } catch { cleanupFailed = true; }
    try { await notifyLogout(); } catch { cleanupFailed = true; }
    setGameRewardAuthorityState('anonymous');
    return cleanupFailed
        ? { ok: false, message: 'アカウントは削除されました。一部の端末データを削除できませんでした。アプリを再起動してください。' }
        : { ok: true };
}

export async function getCurrentUser(): Promise<AuthUserInfo | null> {
    const client = getMobileSupabaseClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    if (!data.session) return null;
    return { userId: data.session.user.id, email: data.session.user.email ?? null };
}

/** バトル開始のため、操作時点のセッションを三値で確認する。 */
export async function getBattleAuthState(): Promise<BattleAuthState> {
    const client = getMobileSupabaseClient();
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

function applyMobileAuthEvent(event: string, session: { user: { id: string } } | null): void {
    if (!recoveryGateHydrated) {
        deferredAuthEvent = { event, session };
        return;
    }
    if (recoveryGateHydrationFailed) {
        setPasswordRecoveryState('invalid');
        return;
    }
    if (event === 'PASSWORD_RECOVERY' && session) {
        recoveryCallbackInProgress = false;
        if (mobileRecoveryGate) {
            setPasswordRecoveryState('ready');
        } else {
            void persistMobileRecoveryGate(true).then((persisted) => {
                if (persisted) setPasswordRecoveryState('ready');
                else {
                    recoveryGateHydrationFailed = true;
                    setPasswordRecoveryState('invalid');
                }
            });
        }
        return;
    }
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
        if (recoveryCallbackInProgress || mobileRecoveryGate || passwordRecoveryState === 'ready') {
            setPasswordRecoveryState('ready');
            return;
        }
        setGameRewardAuthorityState('resolving');
        void restorePendingRewardOperations(session.user.id).catch(() => undefined)
            .then(() => notifyLogin(session.user.id))
            .then(() => setGameRewardAuthorityState('authenticated'));
        return;
    }
    if (event === 'INITIAL_SESSION' && !session) {
        if (mobileRecoveryGate) {
            setPasswordRecoveryState('invalid');
            return;
        }
        detachPendingRewardOperations();
        setGameRewardAuthorityState('anonymous');
        return;
    }
    if (event === 'SIGNED_OUT') {
        if (suppressRecoverySignOut) return;
        detachPendingRewardOperations({ suppressAnonymousRecovery: true });
        setGameRewardAuthorityState('anonymous');
        void notifyLogout();
    }
}

/** アプリ起動時に呼ぶ。復旧ゲートの復元後にのみ通常セッションを有効化する。 */
export function startAuthSessionListener(): () => void {
    const client = getMobileSupabaseClient();
    if (!client) {
        setGameRewardAuthorityState('anonymous');
        return () => {};
    }
    let active = true;
    recoveryGateHydrated = false;
    recoveryGateHydrationFailed = false;
    deferredAuthEvent = null;
    setGameRewardAuthorityState('resolving');
    const { data } = client.auth.onAuthStateChange((event, session) => applyMobileAuthEvent(event, session));
    void hydrateMobileRecoveryGate().then((hydrated) => {
        if (!active) return;
        if (!hydrated) {
            deferredAuthEvent = null;
            setPasswordRecoveryState('invalid');
            return;
        }
        const pending = deferredAuthEvent;
        deferredAuthEvent = null;
        if (pending) applyMobileAuthEvent(pending.event, pending.session);
    });
    return () => {
        active = false;
        data.subscription.unsubscribe();
    };
}
