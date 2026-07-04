/// <reference lib="dom" />
/**
 * Edge Function呼び出しの共有ロジック（ADR-007のクライアント側）。
 *
 * - 常に現在のセッションの access_token を Authorization: Bearer で付与する
 * - 401（トークン失効）のときは1回だけリフレッシュして再試行する
 * - リクエストボディに user_id を含めない（サーバーはJWTからしか読まない）
 *
 * supabase-js への依存を持たない純ロジック。プラットフォーム層（Web/Expo）が
 * セッション取得・リフレッシュ・fetch を注入して使う。
 */

export interface EdgeSession {
    accessToken: string;
}

export interface EdgeFunctionDeps {
    /** Functions のベースURL（例: https://xxx.supabase.co/functions/v1） */
    functionsUrl: string;
    /** anon キー（apikey ヘッダー用） */
    anonKey: string;
    /** 現在のセッション。未ログインなら null */
    getSession: () => Promise<EdgeSession | null>;
    /** セッションのリフレッシュ。失敗なら null */
    refreshSession: () => Promise<EdgeSession | null>;
    fetchFn?: typeof fetch;
}

export class EdgeFunctionError extends Error {
    readonly status: number | null;
    readonly code: string;

    constructor(code: string, message: string, status: number | null = null) {
        super(message);
        this.name = 'EdgeFunctionError';
        this.code = code;
        this.status = status;
    }
}

export type EdgeFunctionInvoker = <TResult>(
    name: string,
    body?: Record<string, unknown>,
) => Promise<TResult>;

/** 依存を束ねてEdge Function呼び出し関数を作る。 */
export function createEdgeFunctionInvoker(deps: EdgeFunctionDeps): EdgeFunctionInvoker {
    const fetchFn = deps.fetchFn ?? fetch;
    const baseUrl = deps.functionsUrl.replace(/\/$/, '');

    const call = (name: string, token: string, body: Record<string, unknown>): Promise<Response> =>
        fetchFn(`${baseUrl}/${name}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: deps.anonKey,
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

    return async <TResult>(name: string, body: Record<string, unknown> = {}): Promise<TResult> => {
        // サーバーはJWTのuser_idしか信用しない（ADR-007）。誤って混入したuser_idは送らない。
        const { user_id: _ignored, userId: _ignored2, ...safeBody } = body;

        const session = await deps.getSession();
        if (!session) {
            throw new EdgeFunctionError('unauthenticated', 'ログインが必要です');
        }

        let response = await call(name, session.accessToken, safeBody);
        if (response.status === 401) {
            const refreshed = await deps.refreshSession();
            if (refreshed) {
                response = await call(name, refreshed.accessToken, safeBody);
            }
        }

        if (!response.ok) {
            let detail = '';
            try {
                detail = await response.text();
            } catch {
                // 本文が読めなくてもステータスで判断できる
            }
            throw new EdgeFunctionError('http-error', `${name} failed: ${response.status} ${detail}`.trim(), response.status);
        }
        return await response.json() as TResult;
    };
}
