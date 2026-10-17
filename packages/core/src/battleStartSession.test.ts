import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from './authLifecycle.ts';
import { requestBattleStart, type BattleAuthState } from './battleStartPolicy.ts';
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
afterEach(() => resetAuthLifecycleHooks());
describe('battle start scope', () => {
    it('認証再確認中のA→logout→Aを同一セッションと取り違えない', async () => {
        await notifyLogin('a');
        const auth = deferred<BattleAuthState>();
        const send = vi.fn(async () => ({}));
        const result = requestBattleStart({ kind: 'authenticated', userId: 'a' }, () => auth.promise, send);
        await notifyLogout(); await notifyLogin('a');
        auth.resolve({ kind: 'authenticated', userId: 'a' });
        expect(await result).toEqual({ kind: 'auth-changed' });
        expect(send).not.toHaveBeenCalled();
    });
    it('結果待ちのA→logout→Aでも開始成功を返さない', async () => {
        await notifyLogin('a');
        const response = deferred<object>();
        const entered = deferred<void>();
        const result = requestBattleStart({ kind: 'authenticated', userId: 'a' }, async () => ({ kind: 'authenticated', userId: 'a' }),
            async () => { entered.resolve(); return response.promise; });
        await entered.promise; await notifyLogout(); await notifyLogin('a');
        response.resolve({});
        expect(await result).toEqual({ kind: 'auth-changed' });
    });
    it('フックが捕捉した所有者とSDKの主体が異なる場合は送信しない', async () => {
        const send = vi.fn(async () => ({}));
        expect(await requestBattleStart({ kind: 'authenticated', userId: 'b' }, async () => ({ kind: 'authenticated', userId: 'b' }), send,
            { expectedUserId: 'a' })).toEqual({ kind: 'auth-changed' });
        expect(send).not.toHaveBeenCalled();
    });
    it('認証済みスコープでSDKがanonymousを返してもローカル開始しない', async () => {
        expect(await requestBattleStart({ kind: 'anonymous' }, async () => ({ kind: 'anonymous' }), async () => null,
            { expectedUserId: 'a' })).toEqual({ kind: 'auth-changed' });
    });
});
