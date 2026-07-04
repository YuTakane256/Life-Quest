/**
 * ExpoのSupabaseクライアント生成を1箇所に集約する（#503）。
 *
 * セッションは expo-secure-store（Keychain/Keystore）に保存する。
 * AsyncStorageへの平文保存は採用しない（ADR-009）。
 * 環境変数（EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY）未設定なら
 * null を返し、アプリは従来どおり完全ローカルで動作する。
 */
import * as SecureStore from 'expo-secure-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

// SecureStoreのキーは英数と ".-_" のみ許可のため、Supabase既定キーを変換する
function toSecureStoreKey(key: string): string {
    return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

export const secureStoreSessionAdapter = {
    getItem: (key: string) => SecureStore.getItemAsync(toSecureStoreKey(key)),
    setItem: (key: string, value: string) => SecureStore.setItemAsync(toSecureStoreKey(key), value),
    removeItem: (key: string) => SecureStore.deleteItemAsync(toSecureStoreKey(key)),
};

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
            },
        })
        : null;
    return cachedClient;
}

/** テスト用: シングルトンを破棄する。 */
export function resetMobileSupabaseClient(): void {
    cachedClient = undefined;
}
