// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/_shared/auth.ts', () => ({
    UnauthorizedError: class extends Error {},
    verifyUser: vi.fn(),
    createServiceClient: vi.fn(),
}));
import { createServiceClient, UnauthorizedError, verifyUser } from '../functions/_shared/auth.ts';
import { BadRequestError, callApply, json, NotFoundError, serveGameFunction } from '../functions/_shared/handler.ts';

type RequestHandler = (request: Request) => Promise<Response>;
let requestHandler: RequestHandler;
const businessHandler = vi.fn();

function request(method = 'POST', body = '{}') {
    return new Request('https://example.invalid/functions/v1/complete_task', {
        method,
        headers: {
            Origin: 'http://127.0.0.1:4175',
            ...(method === 'POST' ? { 'Content-Type': 'application/json', Authorization: 'Bearer test-jwt' } : {}),
            ...(method === 'OPTIONS' ? {
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'authorization,apikey,content-type,x-client-info',
            } : {}),
        },
        ...(method === 'POST' ? { body } : {}),
    });
}

function expectCors(response: Response) {
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')?.split(', ')).toEqual(['POST', 'OPTIONS']);
    expect(response.headers.get('Access-Control-Allow-Headers')?.split(', ')).toEqual(
        expect.arrayContaining(['authorization', 'apikey', 'content-type', 'x-client-info']),
    );
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false);
}

describe('shared Edge Function browser requests', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal('Deno', { serve: (handler: RequestHandler) => { requestHandler = handler; } });
        vi.mocked(verifyUser).mockResolvedValue('verified-owner');
        businessHandler.mockResolvedValue(json(200, { granted: true }));
        serveGameFunction(businessHandler);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('accepts unauthenticated preflight without verifying a user or creating a service client', async () => {
        const response = await requestHandler(request('OPTIONS'));
        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
        expectCors(response);
        expect(verifyUser).not.toHaveBeenCalled();
        expect(createServiceClient).not.toHaveBeenCalled();
        expect(businessHandler).not.toHaveBeenCalled();
    });

    it.each(['GET', 'PUT', 'DELETE'])('keeps %s unsupported', async (method) => {
        const response = await requestHandler(request(method));
        expect(response.status).toBe(405);
        expectCors(response);
        expect(businessHandler).not.toHaveBeenCalled();
        expect(createServiceClient).not.toHaveBeenCalled();
    });

    it.each([
        [new UnauthorizedError(), 401, 'unauthorized'],
        [new Error('auth service unavailable'), 500, 'auth_failure'],
    ])('keeps POST authenticated and returns readable auth errors', async (error, status, message) => {
        vi.mocked(verifyUser).mockRejectedValue(error);
        const response = await requestHandler(request());
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error: message });
        expectCors(response);
        expect(businessHandler).not.toHaveBeenCalled();
        expect(createServiceClient).not.toHaveBeenCalled();
    });

    it('returns a readable invalid-JSON error before any business operation', async () => {
        const response = await requestHandler(request('POST', '{'));
        expect(response.status).toBe(400);
        expectCors(response);
        expect(businessHandler).not.toHaveBeenCalled();
        expect(createServiceClient).not.toHaveBeenCalled();
    });

    it('returns the result and derives ownership from the verified JWT', async () => {
        const response = await requestHandler(request('POST', '{"user_id":"untrusted-owner"}'));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ granted: true });
        expectCors(response);
        expect(businessHandler).toHaveBeenCalledWith(expect.objectContaining({ userId: 'verified-owner' }));
        expect(verifyUser).toHaveBeenCalledOnce();
    });

    it.each([
        [new BadRequestError('bad_request'), 400],
        [new NotFoundError(), 404],
        [new Error('internal_failure'), 500],
    ])('keeps handler failures readable in the browser', async (error, status) => {
        businessHandler.mockRejectedValue(error);
        const response = await requestHandler(request());
        expect(response.status).toBe(status);
        expectCors(response);
    });

    it.each([
        ['stage_locked', 409], ['payload too large', 400], ['database unavailable', 500],
    ])('keeps DB error responses readable in the browser', async (message, status) => {
        const service = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message } }) };
        const response = await callApply(service as unknown as ReturnType<typeof createServiceClient>, 'complete_task_apply', {});
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error: message });
        expectCors(response);
    });
});
