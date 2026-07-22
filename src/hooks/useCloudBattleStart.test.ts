/**
 * `useCloudBattleStart`はReact hookのため、このプロジェクトにはhookを直接
 * 実行するテスト基盤（@testing-library/react等）が無い。代わりに、Reactの
 * 状態管理から切り離して抽出した`runCloudBattleStart`（判断ロジック本体）
 * を直接テストする（`useModalEscape.test.ts`と同じ「純粋関数抽出」方針）。
 */
import { describe, expect, it, vi } from 'vitest';
import { runCloudBattleStart } from './useCloudBattleStart';
import type { CloudBattleAttempt } from '../platform/gameCloud';

describe('runCloudBattleStart', () => {
    it('攻撃側スナップショットを含むattemptが返ればstartCloudBattleへ変換して渡す', async () => {
        const attempt: CloudBattleAttempt = {
            battleAttemptId: 'attempt-1',
            actors: {
                player: { attack: 12, defense: 8, maxHp: 110 },
                enemy: { stage: 1, name: 'スライム', maxHp: 30, attack: 3, defense: 1, xpReward: 5 },
                playerLevel: 2,
                playerName: 'テスト勇者',
            },
        };
        const startCloudBattleAttempt = vi.fn(async () => attempt);
        const startBattle = vi.fn();
        const startCloudBattle = vi.fn();

        await runCloudBattleStart(1, { startCloudBattleAttempt, startBattle, startCloudBattle });

        expect(startCloudBattleAttempt).toHaveBeenCalledWith(1);
        expect(startBattle).not.toHaveBeenCalled();
        expect(startCloudBattle).toHaveBeenCalledWith(
            1,
            'attempt-1',
            { attack: 12, defense: 8, maxHp: 110, level: 2, name: 'テスト勇者' },
            { stage: 1, name: 'スライム', maxHp: 30, attack: 3, defense: 1, xpReward: 5, hp: 30 },
        );
    });

    it('attemptがnull（未接続）ならローカルstartBattleへフォールバックする', async () => {
        const startCloudBattleAttempt = vi.fn(async () => null);
        const startBattle = vi.fn();
        const startCloudBattle = vi.fn();

        await runCloudBattleStart(3, { startCloudBattleAttempt, startBattle, startCloudBattle });

        expect(startBattle).toHaveBeenCalledWith(3);
        expect(startCloudBattle).not.toHaveBeenCalled();
    });

    it('例外（ネットワークエラー等）でもローカルstartBattleへフォールバックする', async () => {
        const startCloudBattleAttempt = vi.fn(async () => { throw new Error('network error'); });
        const startBattle = vi.fn();
        const startCloudBattle = vi.fn();

        await runCloudBattleStart(5, { startCloudBattleAttempt, startBattle, startCloudBattle });

        expect(startBattle).toHaveBeenCalledWith(5);
        expect(startCloudBattle).not.toHaveBeenCalled();
    });
});
