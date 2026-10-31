import { describe, expect, it, vi } from 'vitest';
import { createEdgeFunctionInvoker, EdgeFunctionError } from './edgeFunctions.ts';
import { createCloudOutboxController } from './cloudOutboxController.ts';
import { createSyncOutbox } from './syncOutbox.ts';

async function failure(response: Response, name = 'open_chest') {
    const refreshSession = vi.fn(async () => null);
    const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'test',
        getSession: async () => ({ accessToken: 'test', userId: 'a' }), refreshSession,
        fetchFn: vi.fn(async () => response) });
    try { await invoke(name); } catch (error) {
        expect(error).toBeInstanceOf(EdgeFunctionError);
        return error as EdgeFunctionError;
    }
    throw new Error('expected failure');
}
const marker = 'private-response-marker';

describe('Edge HTTP error privacy', () => {
    it.each([
        [409, 'chest_already_opened'], [409, 'web_migration_required'],
        [409, 'idempotency_key_operation_mismatch'], [404, 'not_found_or_forbidden'],
        [500, 'idempotency_key_operation_mismatch'], [503, 'apple_revocation_failed'],
    ] as const)('keeps fixed %s/%s without arbitrary fields', async (status, code) => {
        const error = await failure(new Response(JSON.stringify({ error: code, details: marker, hint: marker, token: marker }), { status }));
        expect(error).toMatchObject({ code: 'http-error', status });
        expect(error.message).toBe(`open_chest failed: ${status} ${JSON.stringify({ error: code })}`);
        expect(String(error)).not.toContain(marker);
        expect(error.stack).not.toContain(marker);
    });
    it.each([
        `<html>${marker} web_migration_required</html>`,
        JSON.stringify({ error: marker, details: 'web_migration_required' }),
        JSON.stringify({ error: `chest_already_opened: ${marker}` }),
        JSON.stringify([{ error: 'chest_already_opened', details: marker }]),
        JSON.stringify(marker), 'null',
    ])('does not copy an unknown or malformed body into the error', async (body) => {
        const error = await failure(new Response(body, { status: 409 }));
        expect(error.message).toBe('open_chest failed: 409');
    });
    it('does not recognize a migration code on an unrelated status', async () => {
        const error = await failure(new Response('{"error":"web_migration_required"}', { status: 500 }));
        expect(error.message).toBe('open_chest failed: 500');
    });
    it('does not parse or retain large diagnostic text', async () => {
        const body = JSON.stringify({ error: 'chest_already_opened', details: marker.repeat(500) });
        const error = await failure(new Response(body, { status: 409 }));
        expect(error.message).toBe('open_chest failed: 409');
    });
    it.each(['{"error":"payload_too_large"}', '<html>private-response-marker</html>'])('gives readable 413 guidance even for gateway errors', async (body) => {
        const error = await failure(new Response(body, { status: 413 }), 'import_mobile_content');
        expect(error).toMatchObject({ code: 'http-error', status: 413 });
        expect(error.message).toBe('送信データが大きすぎるため、処理できません。内容を確認してください。');
        expect(error.message).not.toContain(marker);
    });
    it('retains the status when reading an error body fails', async () => {
        const error = await failure({ ok: false, status: 502,
            text: async () => { throw new Error(marker); },
        } as unknown as Response);
        expect(error.message).toBe('open_chest failed: 502');
        expect(error.status).toBe(502);
    });
    it.each([false, true])('rejects stale errors after body reading (read failure: %s)', async (reject) => {
        let active = true;
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'test',
            getSession: async () => ({ accessToken: 'test', userId: 'a' }), refreshSession: async () => null,
            fetchFn: vi.fn(async () => ({ ok: false, status: 500, text: async () => {
                active = false;
                if (reject) throw new Error(marker);
                return JSON.stringify({ error: 'internal_error', details: marker });
            } } as unknown as Response)) });
        await expect(invoke('complete_task', {}, { isActive: () => active, expectedUserId: 'a' }))
            .rejects.toMatchObject({ code: 'stale-session' });
    });
});


describe('sanitized errors preserve outbox operations', () => {
    it.each([500, 413])('keeps payload and operation key on HTTP %s', async (status) => {
        const values = new Map<string, string>();
        const storage = { getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid', anonKey: 'test',
            getSession: async () => ({ accessToken: 'test', userId: 'a' }), refreshSession: async () => null,
            fetchFn: vi.fn(async () => new Response(JSON.stringify({ error: marker, details: marker }), { status })) });
        const controller = createCloudOutboxController({ storage, getRpcClient: () => null, getEdgeInvoker: () => invoke });
        const results: unknown[] = [];
        const outbox = createSyncOutbox({ storage, storageKey: 'test-outbox', send: async (op) => {
            const result = await controller.sendOperation(op); results.push(result); return result;
        } });
        await outbox.load();
        try {
            await outbox.enqueue({ operation: 'complete_task', opId: 'same-key', payload: { taskId: 'same-task' } });
            await outbox.flush();
            expect(results).toHaveLength(1);
            expect(JSON.stringify(results)).not.toContain(marker);
            expect(results[0]).toMatchObject({ ok: false, permanent: status === 413 });
            expect(outbox.snapshot()).toMatchObject([{ opId: 'same-key', payload: { taskId: 'same-task' }, status: status === 413 ? 'failed' : 'pending' }]);
            expect(values.get('test-outbox')).not.toContain(marker);
        } finally { await outbox.stop(); }
    });
});
