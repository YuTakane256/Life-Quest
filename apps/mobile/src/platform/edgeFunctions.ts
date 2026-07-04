/**
 * MobileのEdge Function呼び出しラッパー（#503、ADR-007）。
 * ロジック本体は @life-quest/core/edgeFunctions（純関数）にあり、ここは配線のみ。
 */
import {
    createEdgeFunctionInvoker,
    EdgeFunctionError,
    type EdgeFunctionInvoker,
} from '@life-quest/core/edgeFunctions';
import { getMobileSupabaseClient, readMobileSupabaseEnv } from './supabase';

export { EdgeFunctionError };

let cachedInvoker: EdgeFunctionInvoker | null | undefined;

export function getMobileEdgeFunctionInvoker(): EdgeFunctionInvoker | null {
    if (cachedInvoker !== undefined) return cachedInvoker;
    const client = getMobileSupabaseClient();
    const env = readMobileSupabaseEnv();
    if (!client || !env) {
        cachedInvoker = null;
        return cachedInvoker;
    }
    cachedInvoker = createEdgeFunctionInvoker({
        functionsUrl: `${env.url}/functions/v1`,
        anonKey: env.anonKey,
        getSession: async () => {
            const { data } = await client.auth.getSession();
            return data.session ? { accessToken: data.session.access_token } : null;
        },
        refreshSession: async () => {
            const { data, error } = await client.auth.refreshSession();
            if (error || !data.session) return null;
            return { accessToken: data.session.access_token };
        },
    });
    return cachedInvoker;
}

/** テスト用: キャッシュを破棄する。 */
export function resetMobileEdgeFunctionInvoker(): void {
    cachedInvoker = undefined;
}
