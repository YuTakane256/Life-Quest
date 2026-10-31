/** Transport cap, independent of DB collection limits. Never truncate imports. */
export const MAX_EDGE_BODY_BYTES = 5 * 1024 * 1024;

type BodyErrorCode = 'invalid_json' | 'invalid_body' | 'payload_too_large';
export class RequestBodyError extends Error {
    constructor(readonly status: 400 | 413, readonly code: BodyErrorCode) {
        super(code);
    }
}

/** Read only after authentication. Content-Length is an early hint, not a trust boundary. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
    const declared = req.headers.get('Content-Length');
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_EDGE_BODY_BYTES) {
        // Cancellation can reject (or wait on a sender); never let it replace/delay 413.
        void req.body?.cancel().catch(() => {});
        throw new RequestBodyError(413, 'payload_too_large');
    }
    if (!req.body) throw new RequestBodyError(400, 'invalid_json');

    const reader = req.body.getReader();
    let buffer = new Uint8Array(0);
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_EDGE_BODY_BYTES) {
                void reader.cancel().catch(() => {});
                throw new RequestBodyError(413, 'payload_too_large');
            }
            if (size > buffer.length) {
                // A single bounded buffer avoids retaining millions of tiny chunks.
                const capacity = Math.min(MAX_EDGE_BODY_BYTES, Math.max(8192, size, buffer.length * 2));
                const next = new Uint8Array(capacity);
                next.set(buffer);
                buffer = next;
            }
            buffer.set(value, size - value.byteLength);
        }
    } finally {
        reader.releaseLock();
    }

    let body: unknown;
    try {
        body = JSON.parse(new TextDecoder().decode(buffer.subarray(0, size)));
    } catch {
        throw new RequestBodyError(400, 'invalid_json');
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new RequestBodyError(400, 'invalid_body');
    }
    return body as Record<string, unknown>;
}
