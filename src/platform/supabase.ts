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

/** シングルトンのSupabaseクライアント。環境未設定なら null。 */
export function getWebSupabaseClient(): SupabaseClient | null {
    if (cachedClient !== undefined) return cachedClient;
    const env = readWebSupabaseEnv();
    cachedClient = env
        ? createClient(env.url, env.anonKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
            },
        })
        : null;
    return cachedClient;
}

/** テスト用: シングルトンを破棄する。 */
export function resetWebSupabaseClient(): void {
    cachedClient = undefined;
}
