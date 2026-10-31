// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/_shared/auth.ts', () => ({
    UnauthorizedError: class extends Error {}, verifyUser: vi.fn(), createServiceClient: vi.fn(),
}));
import { createServiceClient, UnauthorizedError, verifyUser } from '../functions/_shared/auth.ts';
import { json, serveGameFunction } from '../functions/_shared/handler.ts';

type RequestHandler = (request: Request) => Promise<Response>;
let handle: RequestHandler;
const business = vi.fn();
const LIMIT = 5 * 1024 * 1024;
const encoder = new TextEncoder();
function request(body: BodyInit | null, headers: Record<string, string> = {}) {
    return new Request('https://example.invalid/functions/v1/import_snapshot', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body,
        ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
    } as RequestInit);
}
function streaming(chunks: Uint8Array[], headers: Record<string, string> = {}) {
    let index = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
        }, cancel,
    });
    return { req: request(body, headers), cancel };
}
async function expectRejected(req: Request, status: number, error: string) {
    const response = await handle(req);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(business).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('Deno', { serve: (handler: RequestHandler) => { handle = handler; } });
    vi.mocked(verifyUser).mockResolvedValue('jwt-owner');
    business.mockResolvedValue(json(200, { ok: true }));
    serveGameFunction(business);
});
afterEach(() => vi.unstubAllGlobals());

describe('bounded Edge request bodies', () => {
    it.each(['null', '[]', '42', 'true', '"text"'])('rejects non-object root %s before creating the service client', async (body) => {
        await expectRejected(request(body), 400, 'invalid_body');
    });
    it.each(['', '{', '{"text":'])('rejects empty or malformed JSON', async (body) => {
        await expectRejected(request(body), 400, 'invalid_json');
    });
    it('rejects a declared oversize body without reading it', async () => {
        const req = request('{}', { 'Content-Length': String(LIMIT + 1) });
        const getReader = vi.spyOn(req.body!, 'getReader');
        await expectRejected(req, 413, 'payload_too_large');
        expect(getReader).not.toHaveBeenCalled();
    });
    it.each([undefined, '1', 'invalid'])('measures streamed bytes independently of Content-Length %s', async (length) => {
        const { req, cancel } = streaming([
            encoder.encode(' '.repeat(LIMIT)), encoder.encode(' '), encoder.encode('{}'),
        ], length === undefined ? {} : { 'Content-Length': length });
        await expectRejected(req, 413, 'payload_too_large');
        expect(cancel).toHaveBeenCalledOnce();
    });
    it('rejects a single oversized chunk', async () => {
        await expectRejected(request(' '.repeat(LIMIT) + '{}'), 413, 'payload_too_large');
    });
    it('measures Japanese UTF-8 bytes rather than JavaScript string length', async () => {
        const body = JSON.stringify({ text: 'あ'.repeat(Math.floor(LIMIT / 3)) });
        expect(body.length).toBeLessThan(LIMIT);
        await expectRejected(request(body), 413, 'payload_too_large');
    });
    it('accepts an object exactly at the byte limit', async () => {
        const response = await handle(request(' '.repeat(LIMIT - 2) + '{}'));
        expect(response.status).toBe(200);
        expect(business).toHaveBeenCalledWith(expect.objectContaining({ body: {}, userId: 'jwt-owner' }));
    });
    it('decodes a multibyte character split across chunks and keeps migration fields', async () => {
        const bytes = encoder.encode(JSON.stringify({ platform: 'web', snapshot: { tasks: [{ name: '習慣' }] }, idempotencyKey: 'same-key' }));
        const { req } = streaming(Array.from(bytes, (byte) => new Uint8Array([byte])));
        expect((await handle(req)).status).toBe(200);
        expect(business).toHaveBeenCalledWith(expect.objectContaining({
            body: { platform: 'web', snapshot: { tasks: [{ name: '習慣' }] }, idempotencyKey: 'same-key' },
        }));
    });
    it('keeps authentication ahead of body reads and service creation', async () => {
        vi.mocked(verifyUser).mockRejectedValue(new UnauthorizedError());
        const req = request('{}', { 'Content-Length': String(LIMIT + 1) });
        const getReader = vi.spyOn(req.body!, 'getReader');
        await expectRejected(req, 401, 'unauthorized');
        expect(getReader).not.toHaveBeenCalled();
        await req.body!.cancel();
    });
    it('rejects a missing body', async () => {
        await expectRejected(request(null), 400, 'invalid_json');
    });
    it('keeps 413 even if cancellation of a declared oversized body fails', async () => {
        const req = request('{}', { 'Content-Length': String(LIMIT + 1) });
        const cancel = vi.spyOn(req.body!, 'cancel').mockRejectedValue(new Error('private cancellation diagnostic'));
        await expectRejected(req, 413, 'payload_too_large');
        cancel.mockRestore();
        await req.body!.cancel();
    });
    it('keeps 413 when cancellation after measured overflow fails', async () => {
        const req = request(new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array(LIMIT + 1)); },
            cancel() { return Promise.reject(new Error('private cancellation diagnostic')); },
        }));
        await expectRejected(req, 413, 'payload_too_large');
    });
    it('returns a fixed error when the body stream fails', async () => {
        const body = new ReadableStream({ start(controller) { controller.error(new Error('private stream diagnostic')); } });
        await expectRejected(request(body), 400, 'invalid_json');
    });
});
