// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/_shared/auth.ts', () => ({
    UnauthorizedError: class extends Error {},
    verifyUser: vi.fn(),
    createServiceClient: vi.fn(),
}));
import { createServiceClient, verifyUser } from '../functions/_shared/auth.ts';

type RequestHandler = (request: Request) => Promise<Response>;
const handlers = new Map<string, RequestHandler>();
const functions = ['claim_login_bonus', 'claim_habit_bonus', 'start_battle_attempt', 'open_chest', 'synthesize_items'] as const;

beforeAll(async () => {
    let registered: RequestHandler;
    vi.stubGlobal('Deno', { serve: (handler: RequestHandler) => { registered = handler; } });
    for (const name of functions) {
        await import(`../functions/${name}/index.ts`);
        handlers.set(name, registered!);
    }
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(verifyUser).mockResolvedValue('jwt-owner');
});

// Auth/DB are deliberately mocked. These are the real request wrappers and
// business handlers, including their shared response serialization, not a live DB.
function serviceWithFailure(tableToFail: string) {
    const service = {
        rpc: vi.fn(),
        from: vi.fn((table: string) => {
            const result = table === tableToFail
                ? { data: null, error: { message: 'private database diagnostic', details: 'private row content', hint: 'private hint' } }
                : { data: table === 'characters' ? { name: 'Test character', total_xp: 0 } : null, error: null };
            const query = {
                select: () => query,
                eq: () => query,
                in: () => query,
                is: () => Promise.resolve(result),
                single: () => Promise.resolve(result),
                maybeSingle: () => Promise.resolve(result),
            };
            return query;
        }),
    };
    vi.mocked(createServiceClient).mockReturnValue(service as unknown as ReturnType<typeof createServiceClient>);
    return service;
}

const body = { idempotencyKey: 'test-key', date: '2026-10-31', stage: 1, chestId: 'test-chest', itemIds: ['item-1', 'item-2', 'item-3'] };

describe('real Edge Function wrappers hide database failures', () => {
    it.each([
        ['claim_login_bonus', 'idempotency_keys'],
        ['claim_login_bonus', 'characters'],
        ['claim_habit_bonus', 'habits'],
        ['claim_habit_bonus', 'habit_logs'],
        ['start_battle_attempt', 'inventory_items'],
        ['open_chest', 'idempotency_keys'],
        ['synthesize_items', 'idempotency_keys'],
        ['synthesize_items', 'inventory_items'],
    ])('%s stops safely on %s read failure', async (name, table) => {
        const service = serviceWithFailure(table);
        const response = await handlers.get(name)!(new Request(`https://example.invalid/functions/v1/${name}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }));
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'internal_error' });
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(service.rpc).not.toHaveBeenCalled();
        expect(verifyUser).toHaveBeenCalledOnce();
    });
});
