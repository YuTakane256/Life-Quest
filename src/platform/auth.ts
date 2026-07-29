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
    | { ok: true }
    | { ok: false; message: string };

export interface AuthUserInfo {
    userId: string;
    email: string | null;
}

function notConfigured(): AuthResult {
    return { ok: false, message: 'Supabaseが未設定です（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）' };
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) return { ok: false, message: error.message };
    if (data.session && data.user) {
        setGameRewardAuthorityState('resolving');
        try { restorePendingWebRewardOperations(data.user.id); } catch { /* メモリ保留は維持する */ }
        await notifyLogin(data.user.id);
        setGameRewardAuthorityState('authenticated');
    }
    return { ok: true };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    if (data.user) {
        setGameRewardAuthorityState('resolving');
        try { restorePendingWebRewardOperations(data.user.id); } catch { /* メモリ保留は維持する */ }
        await notifyLogin(data.user.id);
        setGameRewardAuthorityState('authenticated');
    }
    return { ok: true };
}

export async function signOutUser(): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    const { error } = await client.auth.signOut();
    if (error) return { ok: false, message: error.message };
    // ローカルデータ（quest-board-*）は保持する。ここではフック（同期停止・
    // クラウド対象ストアのメモリクリア）だけを完了させる。
    detachPendingWebRewardOperations();
    await notifyLogout();
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
    setGameRewardAuthorityState('resolving');
    const { data } = client.auth.onAuthStateChange((event, session) => {
        if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
            setGameRewardAuthorityState('resolving');
            try { restorePendingWebRewardOperations(session.user.id); } catch { /* メモリ保留は維持する */ }
            void notifyLogin(session.user.id).then(() => setGameRewardAuthorityState('authenticated'));
        }
        if (event === 'INITIAL_SESSION' && !session) {
            detachPendingWebRewardOperations();
            setGameRewardAuthorityState('anonymous');
        }
        if (event === 'SIGNED_OUT') {
            // authenticatedの保留操作をanonymous報酬として消費させない。
            // 永続キーは残し、同一userの次回ログインでのみ復元する。
            detachPendingWebRewardOperations();
            setGameRewardAuthorityState('anonymous');
            void notifyLogout();
        }
    });
    return () => data.subscription.unsubscribe();
}
