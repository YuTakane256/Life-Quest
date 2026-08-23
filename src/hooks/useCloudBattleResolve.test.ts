/**
 * `runCloudBattleResolve`（`useCloudBattleResolve`から抽出した判断ロジック
 * 本体）の直接テスト。`useModalEscape.test.ts`と同じ「純粋関数抽出」方針。
 */
import { describe, expect, it, vi } from 'vitest';
import { runCloudBattleResolve } from './useCloudBattleResolve';

describe('runCloudBattleResolve', () => {
    it('成功時、applyResolvedCloudBattleを適用してからdone/grantedを返す', async () => {
        const resolveCloudBattleAttempt = vi.fn(async () => ({ outcome: 'victory' as const, granted: true }));
        const applyResolvedCloudBattle = vi.fn();

        const outcome = await runCloudBattleResolve(
            'attempt-1',
            [{ type: 'attack' }],
            { resolveCloudBattleAttempt, applyResolvedCloudBattle },
        );

        expect(resolveCloudBattleAttempt).toHaveBeenCalledWith('attempt-1', [{ type: 'attack' }]);
        expect(applyResolvedCloudBattle).toHaveBeenCalledWith('attempt-1', 'victory', true);
        expect(outcome).toEqual({ status: 'done', granted: true });
    });

    it('grantedがfalse（既に付与済み）でもdoneとして反映する', async () => {
        const resolveCloudBattleAttempt = vi.fn(async () => ({ outcome: 'defeat' as const, granted: false }));
        const applyResolvedCloudBattle = vi.fn();

        const outcome = await runCloudBattleResolve(
            'attempt-2',
            [],
            { resolveCloudBattleAttempt, applyResolvedCloudBattle },
        );

        expect(applyResolvedCloudBattle).toHaveBeenCalledWith('attempt-2', 'defeat', false);
        expect(outcome).toEqual({ status: 'done', granted: false });
    });

    it('例外（ネットワークエラー等）はerrorを返し、applyResolvedCloudBattleは呼ばない', async () => {
        const resolveCloudBattleAttempt = vi.fn(async () => { throw new Error('network error'); });
        const applyResolvedCloudBattle = vi.fn();

        const outcome = await runCloudBattleResolve(
            'attempt-3',
            [{ type: 'attack' }],
            { resolveCloudBattleAttempt, applyResolvedCloudBattle },
        );

        expect(applyResolvedCloudBattle).not.toHaveBeenCalled();
        expect(outcome).toEqual({ status: 'error' });
    });

    it('通信失敗後の再送で既に付与済みと返っても、成功応答だけを一度適用する', async () => {
        let calls = 0;
        const resolveCloudBattleAttempt = vi.fn(async () => {
            calls++;
            if (calls === 1) throw new Error('network error');
            return { outcome: 'victory' as const, granted: false };
        });
        const applyResolvedCloudBattle = vi.fn();
        const deps = { resolveCloudBattleAttempt, applyResolvedCloudBattle };

        await expect(runCloudBattleResolve('attempt-retry', [{ type: 'attack' }], deps)).resolves.toEqual({ status: 'error' });
        await expect(runCloudBattleResolve('attempt-retry', [{ type: 'attack' }], deps)).resolves.toEqual({ status: 'done', granted: false });

        expect(resolveCloudBattleAttempt).toHaveBeenNthCalledWith(1, 'attempt-retry', [{ type: 'attack' }]);
        expect(resolveCloudBattleAttempt).toHaveBeenNthCalledWith(2, 'attempt-retry', [{ type: 'attack' }]);
        expect(applyResolvedCloudBattle).toHaveBeenCalledTimes(1);
        expect(applyResolvedCloudBattle).toHaveBeenCalledWith('attempt-retry', 'victory', false);
    });
});
