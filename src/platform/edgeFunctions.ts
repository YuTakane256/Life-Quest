/**
 * WebのEdge Function呼び出しラッパー（#503、ADR-007）。
 * セッションの access_token を自動付与し、失効時は1回リフレッシュして再試行する。
 * ロジック本体は @life-quest/core/edgeFunctions（純関数）にあり、ここは配線のみ。
 */
import {
    createEdgeFunctionInvoker,
    EdgeFunctionError,
    type EdgeFunctionInvoker,
} from '@life-quest/core/edgeFunctions';
import { getWebSupabaseClient, readWebSupabaseEnv } from './supabase';

export { EdgeFunctionError };

let cachedInvoker: EdgeFunctionInvoker | null | undefined;

export function getWebEdgeFunctionInvoker(): EdgeFunctionInvoker | null {
    if (cachedInvoker !== undefined) return cachedInvoker;
    const client = getWebSupabaseClient();
    const env = readWebSupabaseEnv();
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
export function resetWebEdgeFunctionInvoker(): void {
    cachedInvoker = undefined;
}
