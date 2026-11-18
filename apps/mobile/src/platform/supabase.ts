/**
 * ExpoのSupabaseクライアント生成を1箇所に集約する（#503）。
 *
 * セッションは expo-secure-store（Keychain/Keystore）に保存する。
 * AsyncStorageへの平文保存は採用しない（ADR-009）。
 * 環境変数（EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY）未設定なら
 * null を返し、アプリは従来どおり完全ローカルで動作する。
 */
import { secureStoreSessionAdapter } from './secureSessionStorage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export { secureStoreSessionAdapter } from './secureSessionStorage';

export interface SupabaseEnv {
    url: string;
    anonKey: string;
}

export function readMobileSupabaseEnv(): SupabaseEnv | null {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;
    return { url, anonKey };
}

let cachedClient: SupabaseClient | null | undefined;

/** シングルトンのSupabaseクライアント。環境未設定なら null。 */
export function getMobileSupabaseClient(): SupabaseClient | null {
    if (cachedClient !== undefined) return cachedClient;
    const env = readMobileSupabaseEnv();
    cachedClient = env
        ? createClient(env.url, env.anonKey, {
            auth: {
                storage: secureStoreSessionAdapter,
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: false,
                flowType: 'pkce',
            },
        })
        : null;
    return cachedClient;
}

/** テスト用: シングルトンを破棄する。 */
export function resetMobileSupabaseClient(): void {
    cachedClient = undefined;
}
