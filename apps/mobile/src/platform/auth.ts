/**
 * Mobileの認証サービス（#503、メール認証のみ）。Webの src/platform/auth.ts と同型。
 */
import { captureAuthSessionScope, notifyLogin, notifyLogout } from '@life-quest/core/authLifecycle';
import { beginMobileCloudSessionCheck, checkMobileCloudSessionOwner, finishMobileCloudSessionCheck, getMobileCloudRecoveryState, isMobileCloudSessionAccepted } from './cloudSessionRecovery';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import type { BattleAuthState } from '@life-quest/core/battleStartPolicy';
import { getMobileSupabaseClient } from './supabase';
import { detachPendingRewardOperations, restorePendingRewardOperations } from './pendingRewardOperations';
import { getMobileEdgeFunctionInvoker } from './edgeFunctions';
import { cleanupDeletedMobileAccount } from './accountDeletion';
import * as Linking from 'expo-linking';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInWithAppleNative } from './appleSignIn';
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
let recoveryGateHydrated = false;
let recoveryGateHydrationFailed = false;
let mobileRecoveryGate = false;
let deferredAuthEvent: { event: string; session: { user: { id: string } } | null } | null = null;
const processedRecoveryUrls = new Set<string>();
// The browser result and Linking listener can receive the same deep link at the
// same time. Keep the PKCE exchange single-flight and share its outcome.
const mobileGoogleOAuthExchanges = new Map<string, Promise<AuthResult>>();
// PKCE authorization codes are single-use. Retain only successful codes briefly
// so a late duplicate deep link is acknowledged without attempting a second exchange.
const completedMobileGoogleOAuthCodes = new Map<string, number>();
const mobileGoogleOAuthCompletedCodeTtlMs = 5 * 60 * 1000;
const mobileGoogleOAuthCompletedCodeLimit = 50;
let appleSignInInProgress = false;
const mobileRecoveryGateKey = 'life-quest:auth:recovery-pending:v1';
// Expo resolves this from the installed app's scheme, which differs for parity
// and preview builds so their OAuth callbacks cannot open the release app.

function mobileGoogleOAuthRedirectUrl(): string {
    return AuthSession.makeRedirectUri({ path: 'auth/callback' });
}

WebBrowser.maybeCompleteAuthSession();

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

let recoveryGateWrites: Promise<void> = Promise.resolve();
function persistMobileRecoveryGate(pending: boolean, current: () => boolean = () => true): Promise<boolean> {
    const work = recoveryGateWrites.then(async () => {
        if (!current()) return false;
        try {
            if (pending) await AsyncStorage.setItem(mobileRecoveryGateKey, '1');
            else await AsyncStorage.removeItem(mobileRecoveryGateKey);
            if (!current()) return false;
            mobileRecoveryGate = pending;
            return true;
        } catch { return false; }
    });
    recoveryGateWrites = work.then(() => undefined);
    return work;
}

async function hydrateMobileRecoveryGate(): Promise<boolean> {
    try {
        await recoveryGateWrites;
        mobileRecoveryGate = (await AsyncStorage.getItem(mobileRecoveryGateKey)) === '1';
        return true;
    } catch {
        recoveryGateHydrationFailed = true;
        return false;
    } finally {
        recoveryGateHydrated = true;
    }
}

let sessionGeneration = 0;
let recoveryCallbackGeneration = 0;
function invalidateMobileRecoveryCallback(): void {
    recoveryCallbackGeneration += 1;
    recoveryCallbackInProgress = false;
}
let recoveryTeardown: Promise<void> = Promise.resolve();

/** Invalidate the old worker scope synchronously; duplicate SDK events share its cleanup barrier. */
function pauseMobileCloudForRecovery(): Promise<void> {
    beginMobileCloudSessionCheck();
    setGameRewardAuthorityState('resolving');
    setPasswordRecoveryState('idle');
    detachPendingRewardOperations({ suppressAnonymousRecovery: true });
    const stopping = captureAuthSessionScope().userId !== null ? notifyLogout() : Promise.resolve();
    recoveryTeardown = Promise.all([recoveryTeardown, stopping]).then(() => undefined);
    return recoveryTeardown;
}

function receiveMobileRecoverySession(): void {
    const generation = ++sessionGeneration;
    const current = () => generation === sessionGeneration;
    void pauseMobileCloudForRecovery().then(async () => {
        if (!current()) return;
        const persisted = await persistMobileRecoveryGate(true, current);
        if (!current()) return;
        if (persisted) setPasswordRecoveryState('ready');
        else { recoveryGateHydrationFailed = true; setPasswordRecoveryState('invalid'); }
    });
}

async function activateMobileSession(userId: string): Promise<boolean> {
    const generation = ++sessionGeneration;
    invalidateMobileRecoveryCallback();
    const current = () => generation === sessionGeneration;
    beginMobileCloudSessionCheck();
    setGameRewardAuthorityState('resolving');
    const previousOwner = captureAuthSessionScope().userId;
    if (previousOwner !== null && previousOwner !== userId) {
        // Stop A's workers before any of them can use the SDK's new B session.
        // A cold start has no active scope: its retained display must stay protected.
        await notifyLogout();
        if (!current()) return false;
    }
    if (!await checkMobileCloudSessionOwner(userId, current) || !current()) return false;
    await restorePendingRewardOperations(userId).catch(() => undefined);
    if (!current()) return false;
    await notifyLogin(userId);
    if (!current()) return false;
    finishMobileCloudSessionCheck();
    setGameRewardAuthorityState('authenticated');
    return true;
}

async function finishMobileAnonymousSession(): Promise<number> {
    const generation = ++sessionGeneration;
    const current = () => generation === sessionGeneration;
    beginMobileCloudSessionCheck();
    setGameRewardAuthorityState('resolving');
    if (await checkMobileCloudSessionOwner(null, current) && current()) {
        finishMobileCloudSessionCheck();
        setGameRewardAuthorityState('anonymous');
    }
    return generation;
}

function protectedCacheFailure(): AuthResult {
    return { ok: false, message: '保存データを保護しています。以前と同じアカウントでログインしてください。保存領域のエラーがある場合は、空き容量や端末の状態を確認してください。' };
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: mobileEmailVerificationRedirectUrl } });
    if (error) return genericAuthFailure();
    if (data.session && data.user) {
        if (!await activateMobileSession(data.user.id)) return protectedCacheFailure();
    }
    return { ok: true, emailVerificationPending: Boolean(data.user && !data.session) };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return genericAuthFailure();
    if (data.user) {
        if (!await activateMobileSession(data.user.id)) return protectedCacheFailure();
    }
    return { ok: true };
}

const mobilePasswordRecoveryRedirectUrl = 'lifequest://settings?auth=recovery';
const mobileEmailVerificationRedirectUrl = 'lifequest://settings?auth=verify';

/** Starts Google OAuth in the system browser. Auth state events own sync startup. */
export async function signInWithGoogle(): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    try {
        const redirectUrl = mobileGoogleOAuthRedirectUrl();
        const { data, error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl,
                skipBrowserRedirect: true,
            },
        });
        if (error || !data.url) return genericAuthFailure();
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
        if (result.type === 'success') return handleMobileGoogleOAuthCallbackUrl(result.url);
        if (result.type === 'cancel' || result.type === 'dismiss') {
            return { ok: false, message: 'Googleログインをキャンセルしました。' };
        }
        return genericAuthFailure();
    } catch {
        return genericAuthFailure();
    }
}

/** Starts native Apple Sign In on iOS. Supabase auth-state events own sync startup. */
export async function signInWithApple(): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    if (appleSignInInProgress) return { ok: false, message: 'Appleログインを処理中です。' };
    appleSignInInProgress = true;
    try {
        const invoke = getMobileEdgeFunctionInvoker();
        const result = await signInWithAppleNative(client, async (authorizationCode, clientId) => {
            if (!invoke) throw new Error('edge_functions_not_configured');
            await invoke('record_apple_authorization', { authorization_code: authorizationCode, client_id: clientId });
        });
        if (result.ok && result.appleAuthorizationRecorded === false) {
            // Do not leave an Apple session active when its server-side deletion
            // safety material could not be registered. The one-time code is not retained.
            await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
            return { ok: false, message: 'Appleログインの安全設定を完了できませんでした。接続を確認してもう一度お試しください。' };
        }
        return result;
    } finally {
        appleSignInInProgress = false;
    }
}

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
    const generation = sessionGeneration;
    const current = () => generation === sessionGeneration;
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
    if (!await persistMobileRecoveryGate(false, current)) {
        if (!current()) return genericAuthFailure();
        setPasswordRecoveryState('invalid');
        return genericAuthFailure();
    }
    if (!current()) return genericAuthFailure();
    setPasswordRecoveryState('idle');
    if (data.session) {
        if (!await activateMobileSession(data.session.user.id)) return protectedCacheFailure();
    }
    return { ok: true };
}

/** Cancel only the local recovery session; cloud sync has not started for it. */
export async function cancelPasswordRecovery(): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    const generation = ++sessionGeneration;
    invalidateMobileRecoveryCallback();
    await Promise.all([recoveryTeardown, recoveryGateWrites]);
    if (generation !== sessionGeneration) return genericAuthFailure();
    suppressRecoverySignOut = true;
    try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (generation !== sessionGeneration) return genericAuthFailure();
        if (error) return { ok: false, message: 'ログアウトを完了できませんでした。接続を確認してもう一度お試しください。' };
        detachPendingRewardOperations({ suppressAnonymousRecovery: true });
        await notifyLogout();
        if (generation !== sessionGeneration) return genericAuthFailure();
        const anonymousGeneration = await finishMobileAnonymousSession();
        if (anonymousGeneration !== sessionGeneration) return genericAuthFailure();
        if (!await persistMobileRecoveryGate(false, () => anonymousGeneration === sessionGeneration)) {
            if (anonymousGeneration !== sessionGeneration) return genericAuthFailure();
            setPasswordRecoveryState('invalid');
            return genericAuthFailure();
        }
        if (anonymousGeneration !== sessionGeneration) return genericAuthFailure();
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
    const callbackGeneration = isRecoveryCallback ? ++recoveryCallbackGeneration : 0;
    const currentCallback = () => !isRecoveryCallback || callbackGeneration === recoveryCallbackGeneration;
    try {
        if (isRecoveryCallback) {
            recoveryCallbackInProgress = true;
            sessionGeneration += 1;
            await pauseMobileCloudForRecovery();
            if (!currentCallback()) return;
            const persisted = await persistMobileRecoveryGate(true, currentCallback);
            if (!currentCallback()) return;
            if (!persisted) {
                recoveryGateHydrationFailed = true;
                setPasswordRecoveryState('invalid');
                return;
            }
        }
        const result = await client.auth.exchangeCodeForSession(code);
        if (!currentCallback()) return;
        if (result?.error) {
            if (isRecoveryCallback) setPasswordRecoveryState('invalid');
        } else if (result?.data.session && isRecoveryCallback) {
            await recoveryTeardown;
            if (!currentCallback() || !mobileRecoveryGate) return;
            setPasswordRecoveryState('ready');
        }
    } catch {
        if (currentCallback()) setPasswordRecoveryState('invalid');
    } finally {
        if (currentCallback()) recoveryCallbackInProgress = false;
    }
}

/** Accept only the dedicated Google PKCE callback, never bearer tokens or recovery URLs. */
export async function handleMobileGoogleOAuthCallbackUrl(url: string): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    let callback: { parsed: URL; params: URLSearchParams };
    try {
        callback = readMobileRecoveryParams(url);
    } catch {
        return genericAuthFailure();
    }
    const { parsed, params } = callback;
    const expectedCallback = new URL(mobileGoogleOAuthRedirectUrl());
    const isExpectedTarget = parsed.protocol === expectedCallback.protocol &&
        parsed.hostname === expectedCallback.hostname &&
        parsed.pathname === expectedCallback.pathname;
    if (!isExpectedTarget || params.has('access_token') || params.has('refresh_token')) return genericAuthFailure();
    if (params.has('error') || params.has('error_code')) {
        return { ok: false, message: 'Googleでログインを完了できませんでした。もう一度お試しください。' };
    }
    const code = params.get('code');
    if (!code) return genericAuthFailure();
    const existingExchange = mobileGoogleOAuthExchanges.get(code);
    if (existingExchange) return existingExchange;

    const now = Date.now();
    for (const [completedCode, expiresAt] of completedMobileGoogleOAuthCodes) {
        if (expiresAt <= now) completedMobileGoogleOAuthCodes.delete(completedCode);
    }
    if (completedMobileGoogleOAuthCodes.get(code) && completedMobileGoogleOAuthCodes.get(code)! > now) {
        return { ok: true };
    }

    const runExchange = async (): Promise<AuthResult> => {
        try {
            const { error } = await client.auth.exchangeCodeForSession(code);
            if (error) return { ok: false, message: 'Googleでログインを完了できませんでした。もう一度お試しください。' };
            completedMobileGoogleOAuthCodes.set(code, Date.now() + mobileGoogleOAuthCompletedCodeTtlMs);
            while (completedMobileGoogleOAuthCodes.size > mobileGoogleOAuthCompletedCodeLimit) {
                const oldestCode = completedMobileGoogleOAuthCodes.keys().next().value;
                if (!oldestCode) break;
                completedMobileGoogleOAuthCodes.delete(oldestCode);
            }
            return { ok: true };
        } catch {
            return genericAuthFailure();
        }
    };
    const exchange = runExchange().finally(() => {
        if (mobileGoogleOAuthExchanges.get(code) === exchange) {
            mobileGoogleOAuthExchanges.delete(code);
        }
    });
    mobileGoogleOAuthExchanges.set(code, exchange);
    return exchange;
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

/** Receive both recovery and Google OAuth deep links without sharing their validation rules. */
export function startMobileAuthLinkListener(): () => void {
    const handle = (url: string): void => {
        void handleMobileAuthCallbackUrl(url);
        void handleMobileGoogleOAuthCallbackUrl(url);
    };
    void Linking.getInitialURL().then((url) => {
        if (url) handle(url);
    }).catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => handle(url));
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
    await finishMobileAnonymousSession();
    return { ok: true };
}

/** 現在の認証アカウントを削除する。サーバー成功前にはローカル状態を変更しない。 */
export async function deleteCurrentAccount(approval: AccountDeletionApproval): Promise<AccountDeletionResult> {
    const client = getMobileSupabaseClient();
    const invoke = getMobileEdgeFunctionInvoker();
    if (!client || !invoke) return notConfigured();
    return deleteAccountOperation(approval);
}

/** Independent of deferred recovery/pending-reward restoration in the main auth listener. */
export const subscribeAccountDeletionIdentity: SubscribeAccountDeletionIdentity = (listener) => {
    const client = getMobileSupabaseClient();
    if (!client) return () => {};
    const { data } = client.auth.onAuthStateChange((_event, session) => listener(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
};

const deleteAccountOperation = createAccountDeletionOperation({
    subscribeSessionIdentity: subscribeAccountDeletionIdentity,
    getSessionUserId: async () => { const { data, error } = await getMobileSupabaseClient()!.auth.getSession(); if (error) throw error; return data.session?.user.id ?? null; },
    invokeDelete: (options) => getMobileEdgeFunctionInvoker()!('delete_account', {}, options),
    detachRewards: () => detachPendingRewardOperations({ suppressAnonymousRecovery: true }),
    cleanup: cleanupDeletedMobileAccount,
    signOut: async () => { const { error } = await getMobileSupabaseClient()!.auth.signOut({ scope: 'local' }); if (error) throw error; },
    setAnonymous: () => setGameRewardAuthorityState('anonymous'),
});

export async function getCurrentUser(): Promise<AuthUserInfo | null> {
    const client = getMobileSupabaseClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    if (!data.session) return null;
    if (getMobileCloudRecoveryState() !== 'ready' && !isMobileCloudSessionAccepted(data.session.user.id)) return null;
    return { userId: data.session.user.id, email: data.session.user.email ?? null };
}

/** バトル開始のため、操作時点のセッションを三値で確認する。 */
export async function getBattleAuthState(): Promise<BattleAuthState> {
    const client = getMobileSupabaseClient();
    if (!client) return { kind: 'anonymous' };
    try {
        const { data, error } = await client.auth.getSession();
        if (error) return { kind: 'unavailable' };
        if (getMobileCloudRecoveryState() !== 'ready' && (!data.session || !isMobileCloudSessionAccepted(data.session.user.id))) return { kind: 'unavailable' };
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
        if (session) void pauseMobileCloudForRecovery();
        setPasswordRecoveryState('invalid');
        return;
    }
    if (event === 'PASSWORD_RECOVERY' && session) {
        recoveryCallbackInProgress = false;
        receiveMobileRecoverySession();
        return;
    }
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
        if (recoveryCallbackInProgress || mobileRecoveryGate || passwordRecoveryState === 'ready') {
            receiveMobileRecoverySession();
            return;
        }
        void activateMobileSession(session.user.id);
        return;
    }
    if (event === 'INITIAL_SESSION' && !session) {
        if (mobileRecoveryGate) {
            setPasswordRecoveryState('invalid');
            return;
        }
        detachPendingRewardOperations();
        void finishMobileAnonymousSession();
        return;
    }
    if (event === 'SIGNED_OUT') {
        if (suppressRecoverySignOut) return;
        invalidateMobileRecoveryCallback();
        if (mobileRecoveryGate || passwordRecoveryState === 'ready') setPasswordRecoveryState('invalid');
        detachPendingRewardOperations({ suppressAnonymousRecovery: true });
        const generation = ++sessionGeneration;
        beginMobileCloudSessionCheck();
        setGameRewardAuthorityState('resolving');
        void notifyLogout().then(() => {
            if (generation === sessionGeneration) void finishMobileAnonymousSession();
        });
    }
}

/** アプリ起動時に呼ぶ。復旧ゲートの復元後にのみ通常セッションを有効化する。 */
export function startAuthSessionListener(): () => void {
    setPasswordRecoveryState('idle');
    beginMobileCloudSessionCheck();
    const client = getMobileSupabaseClient();
    if (!client) {
        void finishMobileAnonymousSession();
        return () => { sessionGeneration += 1; };
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
            void pauseMobileCloudForRecovery();
            setPasswordRecoveryState('invalid');
            return;
        }
        const pending = deferredAuthEvent;
        deferredAuthEvent = null;
        if (pending) applyMobileAuthEvent(pending.event, pending.session);
    });
    return () => {
        active = false;
        sessionGeneration += 1;
        invalidateMobileRecoveryCallback();
        data.subscription.unsubscribe();
    };
}
