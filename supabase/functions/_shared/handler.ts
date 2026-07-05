/**
 * Edge Function共通のリクエスト処理骨格。
 * - POSTのみ受け付け、JWT検証（ADR-007）とJSONパースを行ってハンドラへ渡す
 * - DB関数のエラーメッセージをHTTPステータスへ写像する
 */
import { createServiceClient, UnauthorizedError, verifyUser } from './auth.ts';

export function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export class BadRequestError extends Error {}
export class NotFoundError extends Error {
    constructor(message = 'not_found_or_forbidden') {
        super(message);
    }
}

const ERROR_STATUS_BY_MESSAGE: [pattern: RegExp, status: number][] = [
    [/not_found_or_forbidden/, 404],
    [/stage_locked|battle_locked|cannot_sell_equipped_item|chest_already_opened|invalid ingredients/, 409],
];

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
        for (const [pattern, status] of ERROR_STATUS_BY_MESSAGE) {
            if (pattern.test(error.message)) return json(status, { error: error.message });
        }
        return json(500, { error: error.message });
    }
    return json(200, data);
}

export function serveGameFunction(
    handler: (ctx: HandlerContext) => Promise<Response>,
): void {
    Deno.serve(async (req: Request) => {
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
            body = await req.json() as Record<string, unknown>;
        } catch {
            return json(400, { error: 'invalid_json' });
        }

        try {
            return await handler({ userId, body, service: createServiceClient() });
        } catch (error) {
            if (error instanceof BadRequestError) return json(400, { error: error.message });
            if (error instanceof NotFoundError) return json(404, { error: error.message });
            return json(500, { error: error instanceof Error ? error.message : 'internal_error' });
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
