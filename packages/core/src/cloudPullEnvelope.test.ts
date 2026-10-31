import { describe, expect, it, vi } from 'vitest';
import { createAccountBoundCloudPullFetcher, createCloudPullRunner } from './cloudPull';

const invalidEnvelopes: { name: string; body: unknown }[] = [
    { name: 'null', body: null }, { name: 'array', body: [] }, { name: 'primitive', body: 'private-response' },
    { name: 'missing control fields', body: { private_detail: 'do not echo' } },
    { name: 'string cursor', body: { next_cursor: '8', has_more: false } },
    { name: 'fractional cursor', body: { next_cursor: 8.5, has_more: false } },
    { name: 'unsafe cursor', body: { next_cursor: Number.MAX_SAFE_INTEGER + 1, has_more: false } },
    { name: 'negative cursor', body: { next_cursor: -1, has_more: false } },
    { name: 'backward cursor', body: { next_cursor: 2, has_more: false } },
    { name: 'string has_more', body: { next_cursor: 8, has_more: 'false' } },
    { name: 'missing has_more', body: { next_cursor: 8 } },
    { name: 'non-progressing page', body: { next_cursor: 3, has_more: true } },
];
describe('cloud pull envelope boundary', () => {
    it.each(invalidEnvelopes)('rejects $name before applying or saving, then retries from the unchanged cursor', async ({ body }) => {
        const applyBatch = vi.fn(); const writeCursor = vi.fn();
        const valid = { next_cursor: 8, has_more: false, tasks: [] };
        // A finite fallback makes the old non-progressing loop fail deterministically.
        const fetchBatch = vi.fn().mockResolvedValueOnce(body).mockResolvedValue(valid);
        const runner = createCloudPullRunner({ fetchBatch, readCursor: async () => 3, applyBatch, writeCursor });
        await expect(runner.flush()).rejects.toThrow(/^cloud pull response invalid$/);
        expect(fetchBatch).toHaveBeenCalledTimes(1); expect(applyBatch).not.toHaveBeenCalled(); expect(writeCursor).not.toHaveBeenCalled();
        await runner.flush();
        expect(fetchBatch).toHaveBeenLastCalledWith(3, 200);
        expect(applyBatch).toHaveBeenCalledExactlyOnceWith(valid); expect(writeCursor).toHaveBeenCalledExactlyOnceWith(8);
    });
    it('accepts an unchanged empty final cursor and unknown future fields', async () => {
        const body = { next_cursor: 3, has_more: false, tasks: [], future_metadata: { version: 'future' } };
        const applyBatch = vi.fn(); const writeCursor = vi.fn();
        await createCloudPullRunner({ fetchBatch: async () => body, readCursor: async () => 3, applyBatch, writeCursor }).flush();
        expect(applyBatch).toHaveBeenCalledExactlyOnceWith(body); expect(writeCursor).not.toHaveBeenCalled();
    });
    it('the account-bound fetcher also refuses an invalid HTTP success body without echoing it', async () => {
        const fetchBatch = createAccountBoundCloudPullFetcher({ expectedUserId: 'a', isActive: () => true,
            getSession: async () => ({ userId: 'a', accessToken: 'private-token' }),
            call: async () => ({ next_cursor: 'private-value', has_more: false }),
        });
        await expect(fetchBatch(3, 200)).rejects.toThrow(/^cloud pull response invalid$/);
    });
    it.each([-1, NaN, '3', 3.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid starting cursor (%s) before network work', async (cursor) => {
        const fetchBatch = vi.fn(); const applyBatch = vi.fn(); const writeCursor = vi.fn();
        const runner = createCloudPullRunner({ fetchBatch, applyBatch, writeCursor, readCursor: vi.fn().mockResolvedValue(cursor) });
        await expect(runner.flush()).rejects.toThrow(/^cloud pull cursor invalid$/);
        expect(fetchBatch).not.toHaveBeenCalled(); expect(applyBatch).not.toHaveBeenCalled(); expect(writeCursor).not.toHaveBeenCalled();
    });
    it('does not invoke control-field getters or accept inherited controls', async () => {
        const getter = vi.fn(() => { throw new Error('private getter detail'); });
        const accessor = { has_more: false }; Object.defineProperty(accessor, 'next_cursor', { get: getter });
        for (const body of [accessor, Object.create({ next_cursor: 8, has_more: false })]) {
            const applyBatch = vi.fn(); const writeCursor = vi.fn();
            await expect(createCloudPullRunner({ fetchBatch: vi.fn().mockResolvedValue(body), readCursor: async () => 3, applyBatch, writeCursor }).flush())
                .rejects.toThrow(/^cloud pull response invalid$/);
            expect(applyBatch).not.toHaveBeenCalled(); expect(writeCursor).not.toHaveBeenCalled();
        }
        expect(getter).not.toHaveBeenCalled();
    });
    it('normalizes inspection failures without retaining arbitrary diagnostics', async () => {
        const proxy = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('private descriptor detail'); } });
        await expect(createCloudPullRunner({ fetchBatch: vi.fn().mockResolvedValue(proxy), readCursor: async () => 3, applyBatch: vi.fn(), writeCursor: vi.fn() }).flush())
            .rejects.toThrow(/^cloud pull response invalid$/);
    });
    it('snapshots validated controls before an asynchronous apply can mutate the envelope', async () => {
        const body = { next_cursor: 8, has_more: false }; const fetchBatch = vi.fn(async () => body); const writeCursor = vi.fn();
        await createCloudPullRunner({ fetchBatch, readCursor: async () => 3, writeCursor,
            applyBatch: async () => { body.next_cursor = 100; body.has_more = true; },
        }).flush();
        expect(fetchBatch).toHaveBeenCalledTimes(1); expect(writeCursor).toHaveBeenCalledExactlyOnceWith(8);
    });
    it('keeps previously committed pages, rejects a later stalled page, and resumes from the committed cursor', async () => {
        let cursor = 3; const applyBatch = vi.fn();
        const fetchBatch = vi.fn().mockResolvedValueOnce({ next_cursor: 8, has_more: true })
            .mockResolvedValueOnce({ next_cursor: 8, has_more: true }).mockResolvedValue({ next_cursor: 9, has_more: false });
        const writeCursor = vi.fn(async (next: number) => { cursor = next; });
        const runner = createCloudPullRunner({ fetchBatch, applyBatch, readCursor: async () => cursor, writeCursor });
        await expect(runner.flush()).rejects.toThrow(/^cloud pull response invalid$/);
        expect(cursor).toBe(8); expect(applyBatch).toHaveBeenCalledTimes(1); expect(writeCursor).toHaveBeenCalledTimes(1);
        await runner.flush(); expect(fetchBatch).toHaveBeenLastCalledWith(8, 200); expect(cursor).toBe(9);
        expect(applyBatch).toHaveBeenCalledTimes(2);
    });

});
