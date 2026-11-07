// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chestOpenRetryKey } from '../../packages/core/src/rewards.ts';
import type { HandlerContext } from '../functions/_shared/handler.ts';

vi.mock('../functions/_shared/handler.ts', () => ({
    NotFoundError: class extends Error {},
    json: (status: number, body: unknown) => new Response(JSON.stringify(body), { status }),
    requireString: (body: Record<string, unknown>, field: string) => body[field],
    serveGameFunction: vi.fn(),
    callApply: vi.fn(() => new Response('{}', { status: 200 })),
}));
import { openChest } from '../functions/open_chest/index.ts';
import { callApply } from '../functions/_shared/handler.ts';

const result = { item_id: 'item', template_id: 'wooden_ring', starter_character: false, version: 42 };
const committed = { data: { operation: 'open_chest', result }, error: null };
const miss = { data: null, error: null };
function context(ledger: Array<{ data: unknown; error: unknown }>, chest: unknown = { id: 'chest', chest_type: 'wood', opened: true }) {
    const filters: Array<[string, unknown]> = [];
    const from = vi.fn(() => {
        const query = {
            select: () => query,
            eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
            is: () => query,
            single: () => Promise.resolve({ data: chest, error: null }),
            maybeSingle: () => Promise.resolve(ledger.shift()),
        };
        return query;
    });
    const ctx = { userId: 'jwt-owner', body: { chestId: 'chest', idempotencyKey: 'retry-key' }, service: { from } } as unknown as HandlerContext;
    return { ctx, from, filters };
}
describe('chest HTTP handler idempotency', () => {
    beforeEach(() => vi.clearAllMocks());
    it('replays the JWT owner result before checking the chest', async () => {
        const { ctx, from, filters } = context([committed]);
        const response = await openChest(ctx);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(result);
        expect(from.mock.calls).toEqual([['idempotency_keys']]);
        expect(filters).toEqual([['user_id', 'jwt-owner'], ['key', 'retry-key']]);
        expect(callApply).not.toHaveBeenCalled();
    });
    it.each([null, { id: 'chest', chest_type: 'wood', opened: true }])('rechecks concurrent commits after opened or missing chest', async (chest) => {
        const { ctx, from } = context([miss, committed], chest);
        const response = await openChest(ctx);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(result);
        expect(from.mock.calls).toEqual([['idempotency_keys'], ['chests'], ['idempotency_keys']]);
        expect(callApply).not.toHaveBeenCalled();
    });
    it.each([0, 1])('fails closed on ledger errors at read %s', async (read) => {
        const failure = { data: null, error: { message: 'ledger unavailable' } };
        const { ctx } = context(read === 0 ? [failure] : [miss, failure]);
        const response = await openChest(ctx);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'internal_error' });
        expect(callApply).not.toHaveBeenCalled();
    });
    it('rejects keys from another operation', async () => {
        const { ctx } = context([{ data: { operation: 'sell_item', result }, error: null }]);
        const response = await openChest(ctx);
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: 'idempotency_key_operation_mismatch' });
    });
    it.each([null, { operation: 'open_chest', result: null }])('does not replay missing or pending results', async (data) => {
        const { ctx } = context([{ data, error: null }, { data, error: null }]);
        expect((await openChest(ctx)).status).toBe(409);
        expect(callApply).not.toHaveBeenCalled();
    });
    it.each([
        chestOpenRetryKey('different-owner', 'chest'),
        chestOpenRetryKey('jwt-owner', 'different-chest'),
    ])('rejects a stable key for a different owner or chest before reading a receipt', async (key) => {
        const { ctx, from } = context([committed]);
        ctx.body.idempotencyKey = key;
        const response = await openChest(ctx);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'idempotency_key_chest_mismatch' });
        expect(from).not.toHaveBeenCalled();
        expect(callApply).not.toHaveBeenCalled();
    });
    it('marks stable ledger replays without modifying their receipt', async () => {
        const { ctx } = context([committed]);
        ctx.body.idempotencyKey = chestOpenRetryKey('jwt-owner', 'chest');
        const response = await openChest(ctx);
        expect(await response.json()).toEqual({ ...result, replayed: true });
        expect(committed.data.result).not.toHaveProperty('replayed');
    });
    it.each([false, true])('marks a stable wood result returned by SQL after a race (replayed=%s)', async (replayed) => {
        const { ctx } = context([miss], { id: 'chest', chest_type: 'wood', opened: false });
        ctx.body.idempotencyKey = chestOpenRetryKey('jwt-owner', 'chest');
        vi.mocked(callApply).mockImplementationOnce(async (_service, _fn, args) => {
            const item = args.p_item as { id: string; template_id: string };
            return new Response(JSON.stringify({ ...result, item_id: replayed ? 'older-item' : item.id, template_id: item.template_id }));
        });
        const response = await openChest(ctx);
        expect((await response.json()).replayed).toBe(replayed);
    });
    it('applies a new unopened chest after a ledger miss', async () => {
        const { ctx } = context([miss], { id: 'chest', chest_type: 'blue', opened: false });
        expect((await openChest(ctx)).status).toBe(200);
        expect(callApply).toHaveBeenCalledWith(ctx.service, 'open_chest_apply', {
            p_user_id: 'jwt-owner', p_chest_id: 'chest', p_item: null, p_key: 'retry-key',
        });
    });
});
