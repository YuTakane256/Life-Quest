import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { CloudPullAuthError, createAccountBoundCloudPullFetcher, createCloudPullRunner, type CloudPullSession, type PullBatch } from './cloudPull';

const batch: PullBatch = { next_cursor: 8, has_more: false };
const owner = { userId: 'a', accessToken: 'a-secret-token' };
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
function fixture() {
    let active = true;
    const getSession = vi.fn<() => Promise<CloudPullSession | null>>().mockResolvedValue(owner);
    const call = vi.fn<(_after: number, _max: number, _token: string) => Promise<PullBatch>>().mockResolvedValue(batch);
    const fetchBatch = createAccountBoundCloudPullFetcher({ expectedUserId: 'a', isActive: () => active, getSession, call });
    return { getSession, call, fetchBatch, stop: () => { active = false; } };
}

describe('account-bound cloud pull', () => {
    it.each([null, { userId: 'b', accessToken: 'b-secret' }, { userId: 'a', accessToken: '' }])('rejects missing/mismatched credentials before transport (%j)', async (session) => {
        const f = fixture(); f.getSession.mockResolvedValue(session);
        await expect(f.fetchBatch(3, 20)).rejects.toThrow('cloud pull account changed');
        expect(f.call).not.toHaveBeenCalled();
    });
    it('keeps the fixed authentication signal while sanitizing ordinary request errors', async () => {
        const f = fixture();
        f.call.mockRejectedValueOnce(new CloudPullAuthError('request'));
        await expect(f.fetchBatch(3, 20)).rejects.toBeInstanceOf(CloudPullAuthError);
        f.call.mockRejectedValueOnce(new Error('private detail 401 unauthorized'));
        await expect(f.fetchBatch(3, 20)).rejects.not.toBeInstanceOf(CloudPullAuthError);
        expect(await f.fetchBatch(3, 20)).toBe(batch);
    });
    it('does not echo SDK authentication diagnostics', async () => {
        const f = fixture(); f.getSession.mockRejectedValue(new Error('private token and user details'));
        await expect(f.fetchBatch(3, 20)).rejects.toThrow(/^cloud pull authentication unavailable$/);
        expect(f.call).not.toHaveBeenCalled();
    });
    it('does not start a stopped session', async () => {
        const f = fixture(); f.stop();
        await expect(f.fetchBatch(3, 20)).rejects.toThrow('cloud pull session inactive');
        expect(f.getSession).not.toHaveBeenCalled(); expect(f.call).not.toHaveBeenCalled();
    });
    it('discards a session read completed after stop', async () => {
        const f = fixture(); const session = deferred<CloudPullSession>(); f.getSession.mockReturnValue(session.promise);
        const result = f.fetchBatch(3, 20);
        f.stop(); session.resolve(owner);
        await expect(result).rejects.toThrow('cloud pull session inactive');
        expect(f.call).not.toHaveBeenCalled();
    });
    it.each([null, { userId: 'b', accessToken: 'b-secret' }])('discards a response when SDK owner changed without lifecycle notification (%j)', async (session) => {
        const f = fixture(); f.getSession.mockResolvedValueOnce(owner).mockResolvedValueOnce(session);
        await expect(f.fetchBatch(3, 20)).rejects.toThrow('cloud pull account changed');
        expect(f.call).toHaveBeenCalledExactlyOnceWith(3, 20, owner.accessToken);
    });
    it('accepts a same-owner refresh and keeps the captured request token', async () => {
        const f = fixture(); f.getSession.mockResolvedValueOnce(owner).mockResolvedValueOnce({ ...owner, accessToken: 'a-refreshed-token' });
        expect(await f.fetchBatch(3, 20)).toBe(batch);
        expect(f.call).toHaveBeenCalledExactlyOnceWith(3, 20, owner.accessToken);
    });
    it('a stopped runner quietly discards a late rejected fetch', async () => {
        const f = fixture(); const response = deferred<PullBatch>(); const applyBatch = vi.fn(); const writeCursor = vi.fn();
        f.call.mockReturnValue(response.promise);
        let active = true;
        const runner = createCloudPullRunner({ fetchBatch: f.fetchBatch, isActive: () => active, readCursor: async () => 3, applyBatch, writeCursor });
        const running = runner.flush();
        await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce());
        active = false; f.stop(); response.resolve(batch);
        await expect(running).resolves.toBeUndefined();
        expect(applyBatch).not.toHaveBeenCalled(); expect(writeCursor).not.toHaveBeenCalled();
    });
    it('a current failed request retains the cursor and retries with the same owner', async () => {
        const f = fixture(); const applyBatch = vi.fn(); const writeCursor = vi.fn();
        f.call.mockRejectedValueOnce(new Error('private server diagnostic'));
        const runner = createCloudPullRunner({ fetchBatch: f.fetchBatch, readCursor: async () => 3, applyBatch, writeCursor });
        await expect(runner.flush()).rejects.toThrow(/^cloud pull request failed$/);
        expect(applyBatch).not.toHaveBeenCalled(); expect(writeCursor).not.toHaveBeenCalled();
        await runner.flush();
        expect(f.call.mock.calls.map(([after]) => after)).toEqual([3, 3]);
        expect(applyBatch).toHaveBeenCalledExactlyOnceWith(batch); expect(writeCursor).toHaveBeenCalledExactlyOnceWith(8);
    });
    it('also rechecks activity after the response owner check', async () => {
        const f = fixture(); f.getSession.mockImplementationOnce(async () => owner).mockImplementationOnce(async () => { f.stop(); return owner; });
        await expect(f.fetchBatch(3, 20)).rejects.toThrow('cloud pull session inactive');
    });
    it('the real SDK preserves explicit A Authorization when its default token is B', async () => {
        const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(batch), { status: 200 }));
        const sdk = createClient('https://example.supabase.co', 'anon', { accessToken: async () => 'b-sdk-token', global: { fetch: fetchFn } });
        const fetchBatch = createAccountBoundCloudPullFetcher({
            expectedUserId: 'a', isActive: () => true, getSession: async () => owner,
            call: async (after, max, token) => {
                const { data, error } = await sdk.rpc('pull_sync_batch', { p_after_version: after, p_max_versions: max }).setHeader('Authorization', `Bearer ${token}`);
                if (error) throw error;
                return data as PullBatch;
            },
        });
        expect(await fetchBatch(3, 20)).toEqual(batch);
        const [url, options] = fetchFn.mock.calls[0];
        expect(String(url)).toContain('/rpc/pull_sync_batch');
        expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${owner.accessToken}`);
        expect(JSON.parse(options!.body as string)).toEqual({ p_after_version: 3, p_max_versions: 20 });
    });
});
