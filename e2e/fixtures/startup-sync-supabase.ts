import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The app receives the real SDK connected to an isolated browser test endpoint.
const env = { url: new URL('/__startup_sync', location.origin).href, anonKey: 'browser-fixture-anon' };
let client: SupabaseClient | undefined;

export function readWebSupabaseEnv() {
    return env;
}

export function getWebSupabaseClient() {
    return client ??= createClient(env.url, env.anonKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
    });
}
export { getGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
