import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimCloudLoginBonus, resolveCloudBattleAttempt, startCloudBattleAttempt } from './battleCloud';

const invoker = vi.fn();

vi.mock('./edgeFunctions', () => ({
    getMobileEdgeFunctionInvoker: () => invoker,
}));

vi.mock('../utils/createMobileId', () => ({
    createMobileId: () => 'op-1',
}));

describe('battleCloud', () => {
    beforeEach(() => {
        invoker.mockReset();
    });

    it('start_battle_attemptのsnake_caseレスポンスをBattleActorsへ変換する', async () => {
        invoker.mockResolvedValueOnce({
            battle_attempt_id: 'attempt-1',
            enemy_snapshot: {
                stage: 1,
                name: 'スライム',
                maxHp: 30,
                attack: 3,
                defense: 1,
                xpReward: 5,
            },
            player_snapshot: {
                name: 'Web勇者',
                level: 2,
                attack: 12,
                defense: 8,
                maxHp: 110,
            },
        });

        const attempt = await startCloudBattleAttempt(1, 'key-1', 'user-1');

        expect(invoker).toHaveBeenCalledWith('start_battle_attempt', {
            stage: 1,
            idempotencyKey: 'key-1',
            expectedUserId: 'user-1',
        });
        expect(attempt).toEqual({
            battleAttemptId: 'attempt-1',
            actors: {
                player: { attack: 12, defense: 8, maxHp: 110 },
                enemy: {
                    stage: 1,
                    name: 'スライム',
                    maxHp: 30,
                    attack: 3,
                    defense: 1,
                    xpReward: 5,
                },
                playerLevel: 2,
                playerName: 'Web勇者',
            },
        });
    });

    it('resolve_battle_attemptへ行動列と冪等キーを送る', async () => {
        invoker.mockResolvedValueOnce({ outcome: 'victory', granted: true });

        await expect(resolveCloudBattleAttempt('attempt-1', [{ type: 'attack' }]))
            .resolves.toEqual({ outcome: 'victory', granted: true });
        expect(invoker).toHaveBeenCalledWith('resolve_battle_attempt', {
            battleAttemptId: 'attempt-1',
            actions: [{ type: 'attack' }],
            idempotencyKey: 'op-1',
        });
    });

    it('claim_login_bonusを冪等キー付きで呼び、snake_caseレスポンスを変換する', async () => {
        invoker.mockResolvedValueOnce({ granted: true, already_claimed: false, claim_date: '2025-03-15', streak: 5, xp: 40, chest_label: null, version: 2 });

        const result = await claimCloudLoginBonus();

        expect(invoker).toHaveBeenCalledWith('claim_login_bonus', { idempotencyKey: 'op-1' });
        expect(result).toEqual({ granted: true, alreadyClaimed: false, claimDate: '2025-03-15', streak: 5, xp: 40, chestLabel: null });
    });
});
