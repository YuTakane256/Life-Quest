/**
 * Edge Function共通のリクエスト処理骨格。
 * - OPTIONSの事前確認に応答し、POSTはJWT検証（ADR-007）とJSONパース後に処理する
 * - DB関数の既知の業務エラーだけを公開し、内部エラーの詳細は返さない
 */
import { createServiceClient, UnauthorizedError, verifyUser } from './auth.ts';
import { readJsonObject, RequestBodyError } from './requestBody.ts';

// Cookie認証は使わず、POSTのBearer JWT検証を維持する。
// Webの配信元・ローカル開発・Nativeで同じAPIを利用できるようにする。
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Only these fixed, intentional server codes may leave the API. Never send
// database messages, exception objects, details/hints or request data in 5xx.
const PUBLIC_SERVER_ERRORS = new Set([
    'internal_error', 'auth_failure', 'account_deletion_failed',
    'apple_authorization_record_failed', 'apple_revocation_failed', 'idempotency_key_operation_mismatch',
]);

export function json(status: number, body: unknown): Response {
    if (status >= 500) {
        const code = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
        body = { error: typeof code === 'string' && PUBLIC_SERVER_ERRORS.has(code) ? code : 'internal_error' };
    }
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

export class BadRequestError extends Error {}
export class NotFoundError extends Error {
    constructor(message = 'not_found_or_forbidden') {
        super(message);
    }
}

// Exact matches only: a known word inside a SQL/transport error must not
// turn the surrounding private diagnostic into a public 4xx response.
const ERROR_STATUS_BY_MESSAGE = new Map<string, number>([
    ['not_found_or_forbidden', 404],
    ['stage_locked', 409], ['battle_locked', 409], ['cannot_sell_equipped_item', 409],
    ['chest_already_opened', 409], ['invalid ingredients', 409],
    ['invalid ingredients: bad count', 409], ['invalid ingredients: duplicates', 409],
    ['web_migration_required', 409], ['payload too large', 400], ['settings payload too large', 400],
    // Existing API contract: reject reuse across operations, without exposing DB details.
    ['idempotency_key_operation_mismatch', 500],
]);

export interface HandlerContext {
    userId: string;
    body: Record<string, unknown>;
    service: ReturnType<typeof createServiceClient>;
}

/** DB RPCを呼び、エラーをHTTP応答へ写像して返す共通処理。 */
export async function callApply(
    service: HandlerContext['service'],
    fn: string,
    params: Record<string, unknown>,
): Promise<Response> {
    const { data, error } = await service.rpc(fn, params);
    if (error) {
        const status = ERROR_STATUS_BY_MESSAGE.get(error.message);
        if (status !== undefined) return json(status, { error: error.message });
        return json(500, { error: 'internal_error' });
    }
    return json(200, data);
}

export function serveGameFunction(
    handler: (ctx: HandlerContext) => Promise<Response>,
): void {
    Deno.serve(async (req: Request) => {
        // ブラウザの事前確認にはJWTがない。業務処理やDBアクセスは行わない。
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
        if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

        let userId: string;
        try {
            userId = await verifyUser(req);
        } catch (error) {
            if (error instanceof UnauthorizedError) return json(401, { error: 'unauthorized' });
            return json(500, { error: 'auth_failure' });
        }

        let body: Record<string, unknown>;
        try {
            body = await readJsonObject(req);
        } catch (error) {
            if (error instanceof RequestBodyError) return json(error.status, { error: error.code });
            return json(400, { error: 'invalid_json' });
        }

        try {
            return await handler({ userId, body, service: createServiceClient() });
        } catch (error) {
            if (error instanceof BadRequestError) return json(400, { error: error.message });
            if (error instanceof NotFoundError) return json(404, { error: error.message });
            return json(500, { error: 'internal_error' });
        }
    });
}

/** 文字列フィールドの必須チェック */
export function requireString(body: Record<string, unknown>, field: string): string {
    const value = body[field];
    if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
        throw new BadRequestError(`missing_or_invalid_${field}`);
    }
    return value;
}
