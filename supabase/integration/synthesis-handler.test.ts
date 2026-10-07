// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { HandlerContext } from '../functions/_shared/handler.ts';
import { SYNTHESIS_CONFIG } from '../../packages/core/src/rewards.ts';

vi.mock('../functions/_shared/handler.ts', () => ({
    BadRequestError: class extends Error {},
    json: (status: number, body: unknown) => new Response(JSON.stringify(body), { status }),
    requireString: (body: Record<string, unknown>, field: string) => body[field],
    serveGameFunction: vi.fn(),
    callApply: vi.fn(() => new Response('{}', { status: 200 })),
}));

import { synthesizeItems } from '../functions/synthesize_items/index.ts';
import { callApply } from '../functions/_shared/handler.ts';

const ingredients = Array.from({ length: SYNTHESIS_CONFIG.REQUIRED_COUNT }, (_, index) => `ingredient-${index}`);
const result = { result_id: 'result', template_id: 'iron_sword', version: 42 };

function context(ledger: Array<{ data: unknown; error: unknown }>) {
    const filters: Array<[string, unknown]> = [];
    const from = vi.fn((table: string) => {
        const query = {
            select: () => query,
            eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
            in: () => query,
            is: () => Promise.resolve({ data: [], error: null }),
            maybeSingle: () => Promise.resolve(ledger.shift()),
        };
        expect(['idempotency_keys', 'inventory_items']).toContain(table);
        return query;
    });
    const ctx = {
        userId: 'jwt-owner', body: { itemIds: ingredients, idempotencyKey: 'retry-key' },
        service: { from },
    } as unknown as HandlerContext;
    return { ctx, from, filters };
}

describe('synthesis HTTP handler idempotency', () => {
    it('replays committed results before reading consumed ingredients using the JWT owner', async () => {
        const { ctx, from, filters } = context([{ data: { operation: 'synthesize_items', result }, error: null }]);
        const response = await synthesizeItems(ctx);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(result);
        expect(from.mock.calls).toEqual([['idempotency_keys']]);
        expect(filters).toEqual([['user_id', 'jwt-owner'], ['key', 'retry-key']]);
    });

    it('rechecks the ledger when a concurrent commit consumes ingredients after the initial miss', async () => {
        const { ctx, from } = context([
            { data: null, error: null },
            { data: { operation: 'synthesize_items', result }, error: null },
        ]);
        const response = await synthesizeItems(ctx);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(result);
        expect(from.mock.calls).toEqual([['idempotency_keys'], ['inventory_items'], ['idempotency_keys']]);
        expect(callApply).not.toHaveBeenCalled();
    });

    it.each([0, 1])('fails closed on ledger read errors at read %s', async (read) => {
        const failure = { data: null, error: { message: 'ledger unavailable' } };
        const { ctx } = context(read === 0 ? [failure] : [{ data: null, error: null }, failure]);
        const response = await synthesizeItems(ctx);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'ledger unavailable' });
        expect(callApply).not.toHaveBeenCalled();
    });

    it('rejects a key belonging to another operation', async () => {
        const { ctx } = context([{ data: { operation: 'sell_item', result }, error: null }]);
        expect((await synthesizeItems(ctx)).status).toBe(409);
    });

    it.each([null, { operation: 'synthesize_items', result: null }])('does not replay missing or pending records', async (data) => {
        const { ctx } = context([{ data, error: null }, { data, error: null }]);
        expect((await synthesizeItems(ctx)).status).toBe(409);
    });

    it('validates the ingredient shape even for a committed key', async () => {
        const { ctx, from } = context([{ data: { operation: 'synthesize_items', result }, error: null }]);
        ctx.body.itemIds = [];
        await expect(synthesizeItems(ctx)).rejects.toThrow('invalid ingredients: wrong count');
        expect(from).not.toHaveBeenCalled();
    });
});
