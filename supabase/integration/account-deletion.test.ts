// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { createClient } from '@supabase/supabase-js';

const DB_URL = process.env.SUPABASE_DB_URL;
const API_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;
const enabled = Boolean(DB_URL && API_URL && ANON_KEY && SERVICE_KEY && FUNCTIONS_URL);

async function createUser(email: string) {
    const admin = createClient(API_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'password-123', email_confirm: true });
    if (error || !data.user) throw new Error(error?.message ?? 'create user failed');
    const client = createClient(API_URL!, ANON_KEY!, { auth: { persistSession: false } });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: 'password-123' });
    if (signInError) throw new Error(signInError.message);
    const { data: session } = await client.auth.getSession();
    return { id: data.user.id, client, token: session.session!.access_token };
}

describe.skipIf(!enabled)('delete_account Edge Function', () => {
    let pg: PgClient;
    let userA: Awaited<ReturnType<typeof createUser>>;
    let userB: Awaited<ReturnType<typeof createUser>>;

    const call = (token?: string, body: Record<string, unknown> = {}) => fetch(`${FUNCTIONS_URL}/delete_account`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });

    beforeAll(async () => {
        pg = new PgClient({ connectionString: DB_URL });
        await pg.connect();
        userA = await createUser(`delete-a-${Date.now()}@example.com`);
        userB = await createUser(`delete-b-${Date.now()}@example.com`);
        await userA.client.rpc('upsert_task', { p_id: crypto.randomUUID(), p_name: '消えるタスク', p_key: crypto.randomUUID() });
    }, 30_000);

    afterAll(async () => { await pg?.end(); });

    it('JWTなし・不正JWTを拒否する', async () => {
        expect((await call()).status).toBe(401);
        expect((await call('not-a-jwt')).status).toBe(401);
    });

    it('bodyの他ユーザーIDを無視し、JWT主体のみをcascade削除する', async () => {
        const response = await call(userA.token, { userId: userB.id, user_id: userB.id });
        expect(response.status).toBe(200);
        const [aAuth, aTasks, bAuth, bTasks] = await Promise.all([
            pg.query('select count(*) from auth.users where id=$1', [userA.id]),
            pg.query('select count(*) from public.tasks where user_id=$1', [userA.id]),
            pg.query('select count(*) from auth.users where id=$1', [userB.id]),
            pg.query('select count(*) from public.tasks where user_id=$1', [userB.id]),
        ]);
        expect(aAuth.rows[0].count).toBe('0');
        expect(aTasks.rows[0].count).toBe('0');
        expect(bAuth.rows[0].count).toBe('1');
        expect(bTasks.rows[0].count).toBe('0');
    });
});
