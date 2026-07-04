/**
 * Edge Function共通の認可（ADR-007）。
 * Authorization ヘッダーのJWTを検証し、user_id はここから導出した値のみを使う。
 * リクエストボディの user_id は読まない。
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

export class UnauthorizedError extends Error {
    constructor() {
        super('unauthorized');
        this.name = 'UnauthorizedError';
    }
}

/** JWTを検証してuser_idを返す。失敗なら UnauthorizedError。 */
export async function verifyUser(req: Request): Promise<string> {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedError();

    const anonClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
    );
    const token = authHeader.slice('Bearer '.length);
    const { data, error } = await anonClient.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedError();
    return data.user.id;
}

/** service roleクライアント。RLSを迂回するため全クエリで明示的にuser_idを検証すること。 */
export function createServiceClient() {
    return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false } },
    );
}
