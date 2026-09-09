/**
 * WebのSupabaseクライアント生成を1箇所に集約する（#503）。
 *
 * 環境変数（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）が未設定の場合は
 * null を返し、アプリは従来どおり完全ローカルで動作する（未ログイン利用の継続）。
 * anon キーのみを扱う。service roleキーは絶対にここへ持ち込まない（ADR-007）。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseEnv {
    url: string;
    anonKey: string;
}

export function readWebSupabaseEnv(): SupabaseEnv | null {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !anonKey) return null;
    return { url, anonKey };
}

let cachedClient: SupabaseClient | null | undefined;

/**
 * Supabase returns provider tokens transiently after OAuth. Keep them available
 * to the callback long enough to hand off to the Edge Function, but never put
 * them in browser storage with the durable Life Quest session.
 */
export const webSessionStorageAdapter = {
    getItem: (key: string): string | null => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
    setItem: (key: string, value: string): void => {
        if (typeof window === 'undefined') return;
        try {
            const parsed = JSON.parse(value) as Record<string, unknown>;
            if (parsed && typeof parsed === 'object') {
                delete parsed.provider_token;
                delete parsed.provider_refresh_token;
                window.localStorage.setItem(key, JSON.stringify(parsed));
                return;
            }
        } catch {
            // Auth-js owns the serialized shape. Preserve non-session values.
        }
        window.localStorage.setItem(key, value);
    },
    removeItem: (key: string): void => { if (typeof window !== 'undefined') window.localStorage.removeItem(key); },
};

/** シングルトンのSupabaseクライアント。環境未設定なら null。 */
export function getWebSupabaseClient(): SupabaseClient | null {
    if (cachedClient !== undefined) return cachedClient;
    const env = readWebSupabaseEnv();
    cachedClient = env
        ? createClient(env.url, env.anonKey, {
            auth: {
                storage: webSessionStorageAdapter,
                persistSession: true,
                autoRefreshToken: true,
                flowType: 'pkce',
                // Google and Apple OAuth are consumed explicitly in auth.ts so they can validate
                // the callback target and remove the authorization code from history.
                // Email confirmation and recovery retain Supabase's existing handling.
                detectSessionInUrl: !isWebOAuthCallbackUrl(),
            },
        })
        : null;
    return cachedClient;
}

function isWebOAuthCallbackUrl(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const url = new URL(window.location.href);
        return url.pathname === '/settings' &&
            (url.searchParams.get('auth') === 'oauth' || url.searchParams.get('auth') === 'apple-oauth');
    } catch {
        return false;
    }
}

/** テスト用: シングルトンを破棄する。 */
export function resetWebSupabaseClient(): void {
    cachedClient = undefined;
}
