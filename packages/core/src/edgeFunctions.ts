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

import { edgeHttpErrorMessage, sanitizeEdgeErrorDetail } from './edgeErrorPolicy.ts';

export interface EdgeSession {
    accessToken: string;
    userId?: string;
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

export interface EdgeFunctionCallOptions {
    isActive: () => boolean;
    /** When set, fail closed unless token metadata belongs to this user. */
    expectedUserId?: string;
}

export type EdgeFunctionInvoker = <TResult>(
    name: string,
    body?: Record<string, unknown>,
    /** Optional caller-owned scope guard; never serialized into the request. */
    options?: EdgeFunctionCallOptions,
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

    return async <TResult>(name: string, body: Record<string, unknown> = {}, options?: EdgeFunctionCallOptions): Promise<TResult> => {
        const assertActive = (session?: EdgeSession | null): void => {
            if (options && (!options.isActive()
                || (session !== undefined && options.expectedUserId !== undefined && session?.userId !== options.expectedUserId))) {
                throw new EdgeFunctionError('stale-session', 'アカウントが切り替わったため、処理を中止しました');
            }
        };
        assertActive();
        // サーバーはJWTのuser_idしか信用しない（ADR-007）。誤って混入したuser_idは送らない。
        const { user_id: _ignored, userId: _ignored2, ...safeBody } = body;

        const session = await deps.getSession();
        assertActive(session);
        if (!session) {
            throw new EdgeFunctionError('unauthenticated', 'ログインが必要です');
        }

        let response = await call(name, session.accessToken, safeBody);
        assertActive();
        if (response.status === 401) {
            const refreshed = await deps.refreshSession();
            assertActive(refreshed);
            if (refreshed) {
                response = await call(name, refreshed.accessToken, safeBody);
                assertActive();
            }
        }

        if (!response.ok) {
            let detail = '';
            try {
                detail = sanitizeEdgeErrorDetail(response.status, await response.text());
            } catch {
                // 本文が読めなくてもステータスで判断できる
            }
            assertActive();
            throw new EdgeFunctionError('http-error', edgeHttpErrorMessage(name, response.status, detail), response.status);
        }
        const result = await response.json() as TResult;
        assertActive();
        return result;
    };
}
