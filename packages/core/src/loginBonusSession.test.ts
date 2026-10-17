import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from './authLifecycle.ts';
import { requestLoginBonusClaim } from './loginBonusPolicy.ts';
import { EdgeFunctionError } from './edgeFunctions.ts';
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
const auth = { kind: 'authenticated' as const, userId: 'a' };
const bonus = { granted: true, alreadyClaimed: false, claimDate: '2026-10-17', streak: 1, xp: 20, chestLabel: null };
afterEach(() => resetAuthLifecycleHooks());
describe('login bonus scope policy', () => {
    it('認証再確認待ちのA→logout→Aで請求しない', async () => {
        await notifyLogin('a'); const gate = deferred<typeof auth>(); const claim = vi.fn(async () => bonus);
        const result = requestLoginBonusClaim(auth, () => gate.promise, claim);
        await notifyLogout(); await notifyLogin('a'); gate.resolve(auth);
        expect(await result).toEqual({ kind: 'auth-changed' }); expect(claim).not.toHaveBeenCalled();
    });
    it('応答待ちのA→logout→Aを古い受領結果で確定しない', async () => {
        await notifyLogin('a'); const response = deferred<typeof bonus>(); const entered = deferred<void>();
        const result = requestLoginBonusClaim(auth, async () => auth, async () => { entered.resolve(); return response.promise; });
        await entered.promise; await notifyLogout(); await notifyLogin('a'); response.resolve(bonus);
        expect(await result).toEqual({ kind: 'auth-changed' });
    });
    it('Edgeの所有者不一致は通信再試行ではなく認証変更として扱う', async () => {
        expect(await requestLoginBonusClaim(auth, async () => auth, async () => { throw new EdgeFunctionError('stale-session', 'changed'); }))
            .toEqual({ kind: 'auth-changed' });
    });
    it('匿名SDK状態も、認証済みスコープと食い違う場合はローカル付与しない', async () => {
        expect(await requestLoginBonusClaim({ kind: 'anonymous' }, async () => ({ kind: 'anonymous' }), async () => null,
            { expectedUserId: 'a' })).toEqual({ kind: 'auth-changed' });
    });
});
