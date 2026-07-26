import { describe, expect, it, vi } from 'vitest';
import { EdgeFunctionError } from './edgeFunctions.ts';
import { createBattleStartGate, getBattleStartMessage, requestBattleStart } from './battleStartPolicy.ts';

describe('requestBattleStart', () => {
    it('開始ゲートは状態更新前の連打も同期的に拒否する', () => {
        const gate = createBattleStartGate();
        expect(gate.tryEnter()).toBe(true);
        expect(gate.tryEnter()).toBe(false);
        gate.leave();
        expect(gate.tryEnter()).toBe(true);
    });

    it('anonymous のときだけローカル開始を許可し、クラウドを呼ばない', async () => {
        const requestCloudAttempt = vi.fn();
        await expect(requestBattleStart({ kind: 'anonymous' }, async () => ({ kind: 'anonymous' }), requestCloudAttempt)).resolves.toEqual({ kind: 'local-started' });
        expect(requestCloudAttempt).not.toHaveBeenCalled();
    });

    it('unavailable は開始を止める', async () => {
        const requestCloudAttempt = vi.fn();
        await expect(requestBattleStart({ kind: 'unavailable' }, async () => ({ kind: 'unavailable' }), requestCloudAttempt)).resolves.toEqual({ kind: 'unavailable' });
        expect(requestCloudAttempt).not.toHaveBeenCalled();
    });

    it('authenticated の成功だけクラウド開始にする', async () => {
        const attempt = { id: 'attempt-1' };
        const auth = { kind: 'authenticated' as const, userId: 'user-1' };
        await expect(requestBattleStart(auth, async () => auth, async () => attempt)).resolves.toEqual({ kind: 'cloud-started', attempt });
    });

    const failures: readonly [string, () => Promise<never | null>, string][] = [
        ['null', async (): Promise<null> => null, 'retryable-error'],
        ['network', async (): Promise<never> => { throw new Error('offline'); }, 'retryable-error'],
        ['5xx', async (): Promise<never> => { throw new EdgeFunctionError('http-error', 'server', 500); }, 'retryable-error'],
        ['401', async (): Promise<never> => { throw new EdgeFunctionError('http-error', 'expired', 401); }, 'auth-error'],
        ['4xx', async (): Promise<never> => { throw new EdgeFunctionError('http-error', 'invalid', 409); }, 'rejected'],
    ];

    it.each(failures)('authenticated の %s はローカル開始を許可しない', async (_name, request, expected) => {
        const auth = { kind: 'authenticated' as const, userId: 'user-1' };
        await expect(requestBattleStart(auth, async () => auth, request)).resolves.toEqual({ kind: expected });
    });

    it('開始前に別ユーザーへ切り替わった場合はクラウドリクエストを送らない', async () => {
        const requestCloudAttempt = vi.fn();
        await expect(requestBattleStart(
            { kind: 'authenticated', userId: 'user-1' },
            async () => ({ kind: 'authenticated', userId: 'user-2' }),
            requestCloudAttempt,
        )).resolves.toEqual({ kind: 'auth-changed' });
        expect(requestCloudAttempt).not.toHaveBeenCalled();
    });

    it('開始応答後にログアウトした場合はクラウド戦闘を開始しない', async () => {
        let calls = 0;
        await expect(requestBattleStart(
            { kind: 'authenticated', userId: 'user-1' },
            async () => (++calls === 1 ? { kind: 'authenticated', userId: 'user-1' } : { kind: 'anonymous' }),
            async () => ({ id: 'attempt-1' }),
        )).resolves.toEqual({ kind: 'auth-changed' });
    });

    it('失敗種別ごとに再試行可能な案内を返す', () => {
        expect(getBattleStartMessage({ kind: 'auth-error' })).toContain('再ログイン');
        expect(getBattleStartMessage({ kind: 'retryable-error' })).toContain('通信');
        expect(getBattleStartMessage({ kind: 'rejected' })).toContain('更新');
        expect(getBattleStartMessage({ kind: 'auth-changed' })).toContain('ログイン状態');
    });
});
