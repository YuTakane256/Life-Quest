/**
 * Mobileの認証サービス（#503、メール認証のみ）。Webの src/platform/auth.ts と同型。
 */
import { notifyLogin, notifyLogout } from '@life-quest/core/authLifecycle';
import { getMobileSupabaseClient } from './supabase';

export type AuthResult =
    | { ok: true }
    | { ok: false; message: string };

export interface AuthUserInfo {
    userId: string;
    email: string | null;
}

function notConfigured(): AuthResult {
    return { ok: false, message: 'Supabaseが未設定です（EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY)' };
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) return { ok: false, message: error.message };
    if (data.session && data.user) {
        await notifyLogin(data.user.id);
    }
    return { ok: true };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    if (data.user) {
        await notifyLogin(data.user.id);
    }
    return { ok: true };
}

export async function signOutUser(): Promise<AuthResult> {
    const client = getMobileSupabaseClient();
    if (!client) return notConfigured();
    const { error } = await client.auth.signOut();
    if (error) return { ok: false, message: error.message };
    // ローカルデータ（quest-board-*）は保持する。フック（同期停止・ストアクリア）の
    // 完了を待ってから解決する（ADR-009）。
    await notifyLogout();
    return { ok: true };
}

export async function getCurrentUser(): Promise<AuthUserInfo | null> {
    const client = getMobileSupabaseClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    if (!data.session) return null;
    return { userId: data.session.user.id, email: data.session.user.email ?? null };
}

/** アプリ起動時に呼ぶ。セッション復元時に notifyLogin を発火する。 */
export function startAuthSessionListener(): () => void {
    const client = getMobileSupabaseClient();
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
