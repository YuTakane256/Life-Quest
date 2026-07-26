/**
 * Webの認証サービス（#503、メール認証のみ）。
 *
 * - サインアップ/ログイン/ログアウトとセッション復元
 * - セッション確立時に notifyLogin、ログアウト時に notifyLogout（core authLifecycle）
 * - ログアウトは notifyLogout の全フック完了を待ってから解決する（ADR-009:
 *   ストアのメモリ即時クリアがログアウトAPIの一部として完了する契約）
 */
import { notifyLogin, notifyLogout } from '@life-quest/core/authLifecycle';
import type { BattleAuthState } from '@life-quest/core/battleStartPolicy';
import { getWebSupabaseClient } from './supabase';

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
        await notifyLogin(data.user.id);
    }
    return { ok: true };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
    const client = getWebSupabaseClient();
    if (!client) return notConfigured();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    if (data.user) {
        await notifyLogin(data.user.id);
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
    await notifyLogout();
    return { ok: true };
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

/**
 * アプリ起動時に呼ぶ。保存済みセッションが復元されたら notifyLogin を発火する。
 * 戻り値で購読解除できる。
 */
export function startAuthSessionListener(): () => void {
    const client = getWebSupabaseClient();
    if (!client) return () => {};
    const { data } = client.auth.onAuthStateChange((event, session) => {
        if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
            void notifyLogin(session.user.id);
        }
        if (event === 'SIGNED_OUT') {
            void notifyLogout();
        }
    });
    return () => data.subscription.unsubscribe();
}
