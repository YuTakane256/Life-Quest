import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCloudBattleAttempt, startCloudBattleAttempt } from './gameCloud';

const invoker = vi.fn();

vi.mock('./edgeFunctions', () => ({
    getWebEdgeFunctionInvoker: () => invoker,
}));

describe('gameCloud（Webアダプタ）', () => {
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

        const attempt = await startCloudBattleAttempt(1);

        expect(invoker).toHaveBeenCalledWith('start_battle_attempt', expect.objectContaining({ stage: 1 }));
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
        expect(invoker).toHaveBeenCalledWith('resolve_battle_attempt', expect.objectContaining({
            battleAttemptId: 'attempt-1',
            actions: [{ type: 'attack' }],
        }));
    });
});
