import { describe, expect, it, vi } from 'vitest';
import { EdgeFunctionError } from './edgeFunctions.ts';
import { requestLoginBonusClaim } from './loginBonusPolicy.ts';

const bonus = {
    granted: true,
    alreadyClaimed: false,
    claimDate: '2026-07-26',
    streak: 3,
    xp: 30,
    chestLabel: null,
};

describe('requestLoginBonusClaim', () => {
    it('anonymous のときだけローカル報酬を許可する', async () => {
        const request = vi.fn();
        await expect(requestLoginBonusClaim({ kind: 'anonymous' }, async () => ({ kind: 'anonymous' }), request))
            .resolves.toEqual({ kind: 'local-eligible' });
        expect(request).not.toHaveBeenCalled();
    });

    it('認証済みの成功と既受領を明示的に分ける', async () => {
        const auth = { kind: 'authenticated' as const, userId: 'user-1' };
        await expect(requestLoginBonusClaim(auth, async () => auth, async () => bonus))
            .resolves.toEqual({ kind: 'cloud-granted', bonus });
        await expect(requestLoginBonusClaim(auth, async () => auth, async () => ({ ...bonus, granted: false, alreadyClaimed: true, xp: 0 })))
            .resolves.toMatchObject({ kind: 'already-claimed' });
    });

    const failures: readonly [string, () => Promise<never | null>, string][] = [
        ['null', async (): Promise<null> => null, 'retryable-error'],
        ['network', async (): Promise<never> => { throw new Error('offline'); }, 'retryable-error'],
        ['5xx', async (): Promise<never> => { throw new EdgeFunctionError('http-error', 'server', 500); }, 'retryable-error'],
        ['401', async (): Promise<never> => { throw new EdgeFunctionError('http-error', 'expired', 401); }, 'auth-error'],
        ['4xx', async (): Promise<never> => { throw new EdgeFunctionError('http-error', 'invalid', 409); }, 'rejected'],
    ];

    it.each(failures)('認証済みの %s はローカル報酬を許可しない', async (_name, request, expected) => {
        const auth = { kind: 'authenticated' as const, userId: 'user-1' };
        await expect(requestLoginBonusClaim(auth, async () => auth, request)).resolves.toEqual({ kind: expected });
    });

    it('請求の前後でアカウントが切り替わった応答は捨てる', async () => {
        let calls = 0;
        await expect(requestLoginBonusClaim(
            { kind: 'authenticated', userId: 'user-1' },
            async () => (++calls === 1 ? { kind: 'authenticated', userId: 'user-1' } : { kind: 'authenticated', userId: 'user-2' }),
            async () => bonus,
        )).resolves.toEqual({ kind: 'auth-changed' });
    });
});
