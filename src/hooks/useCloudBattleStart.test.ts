/**
 * `useCloudBattleStart`はReact hookのため、このプロジェクトにはhookを直接
 * 実行するテスト基盤（@testing-library/react等）が無い。代わりに、Reactの
 * 状態管理から切り離して抽出した`runCloudBattleStart`（判断ロジック本体）
 * を直接テストする（`useModalEscape.test.ts`と同じ「純粋関数抽出」方針）。
 */
import { describe, expect, it, vi } from 'vitest';
import { runCloudBattleStart } from './useCloudBattleStart';
import type { CloudBattleAttempt } from '../platform/gameCloud';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';

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

        await expect(runCloudBattleStart(1, 'key-1', {
            getBattleAuthState: async () => ({ kind: 'authenticated', userId: 'user-1' }), startCloudBattleAttempt, startBattle, startCloudBattle,
        })).resolves.toMatchObject({ kind: 'cloud-started' });

        expect(startCloudBattleAttempt).toHaveBeenCalledWith(1, 'key-1', 'user-1');
        expect(startBattle).not.toHaveBeenCalled();
        expect(startCloudBattle).toHaveBeenCalledWith(
            1,
            'attempt-1',
            { attack: 12, defense: 8, maxHp: 110, level: 2, name: 'テスト勇者' },
            { stage: 1, name: 'スライム', maxHp: 30, attack: 3, defense: 1, xpReward: 5, hp: 30 },
        );
    });

    it('認証済みでattemptがnullならローカルstartBattleを呼ばない', async () => {
        const startCloudBattleAttempt = vi.fn(async () => null);
        const startBattle = vi.fn();
        const startCloudBattle = vi.fn();

        await expect(runCloudBattleStart(3, 'key-3', {
            getBattleAuthState: async () => ({ kind: 'authenticated', userId: 'user-1' }), startCloudBattleAttempt, startBattle, startCloudBattle,
        })).resolves.toEqual({ kind: 'retryable-error' });

        expect(startBattle).not.toHaveBeenCalled();
        expect(startCloudBattle).not.toHaveBeenCalled();
    });

    it('認証済みのネットワーク例外でもローカルstartBattleを呼ばない', async () => {
        const startCloudBattleAttempt = vi.fn(async () => { throw new Error('network error'); });
        const startBattle = vi.fn();
        const startCloudBattle = vi.fn();

        await expect(runCloudBattleStart(5, 'key-5', {
            getBattleAuthState: async () => ({ kind: 'authenticated', userId: 'user-1' }), startCloudBattleAttempt, startBattle, startCloudBattle,
        })).resolves.toEqual({ kind: 'retryable-error' });

        expect(startBattle).not.toHaveBeenCalled();
        expect(startCloudBattle).not.toHaveBeenCalled();
    });

    it('通信失敗後は同じ冪等キーで再送し、クラウド戦闘を一度だけ開始する', async () => {
        let calls = 0;
        const attempt: CloudBattleAttempt = {
            battleAttemptId: 'attempt-retry',
            actors: {
                player: { attack: 10, defense: 5, maxHp: 50 },
                enemy: { stage: 2, name: '敵', maxHp: 20, attack: 2, defense: 1, xpReward: 4 },
                playerLevel: 1,
                playerName: '勇者',
            },
        };
        const startCloudBattleAttempt = vi.fn(async () => {
            calls++;
            if (calls === 1) throw new Error('network error');
            return attempt;
        });
        const startBattle = vi.fn();
        const startCloudBattle = vi.fn();
        const deps = {
            getBattleAuthState: async () => ({ kind: 'authenticated' as const, userId: 'user-1' }),
            startCloudBattleAttempt,
            startBattle,
            startCloudBattle,
        };

        await expect(runCloudBattleStart(2, 'retry-key', deps)).resolves.toEqual({ kind: 'retryable-error' });
        await expect(runCloudBattleStart(2, 'retry-key', deps)).resolves.toMatchObject({ kind: 'cloud-started' });

        expect(startCloudBattleAttempt).toHaveBeenNthCalledWith(1, 2, 'retry-key', 'user-1');
        expect(startCloudBattleAttempt).toHaveBeenNthCalledWith(2, 2, 'retry-key', 'user-1');
        expect(startCloudBattle).toHaveBeenCalledTimes(1);
        expect(startBattle).not.toHaveBeenCalled();
    });

    it('匿名利用者だけローカルstartBattleへ進む', async () => {
        const startCloudBattleAttempt = vi.fn();
        const startBattle = vi.fn();
        const startCloudBattle = vi.fn();

        await expect(runCloudBattleStart(2, 'key-2', {
            getBattleAuthState: async () => ({ kind: 'anonymous' }), startCloudBattleAttempt, startBattle, startCloudBattle,
        })).resolves.toEqual({ kind: 'local-started' });

        expect(startCloudBattleAttempt).not.toHaveBeenCalled();
        expect(startBattle).toHaveBeenCalledWith(2);
    });

    it('401では再ログインが必要な結果を返し、ローカル開始しない', async () => {
        const startBattle = vi.fn();
        await expect(runCloudBattleStart(2, 'key-2', {
            getBattleAuthState: async () => ({ kind: 'authenticated', userId: 'user-1' }),
            startCloudBattleAttempt: async () => { throw new EdgeFunctionError('http-error', 'expired', 401); },
            startBattle,
            startCloudBattle: vi.fn(),
        })).resolves.toEqual({ kind: 'auth-error' });
        expect(startBattle).not.toHaveBeenCalled();
    });

    it('次へ用の事前遷移は開始失敗時に実行せず、成功時だけ実行する', async () => {
        const beforeStart = vi.fn();
        const startCloudBattle = vi.fn();
        const failed = await runCloudBattleStart(2, 'next-key', {
            getBattleAuthState: async () => ({ kind: 'authenticated', userId: 'user-1' }),
            startCloudBattleAttempt: async () => null,
            startBattle: vi.fn(),
            startCloudBattle,
        }, beforeStart);
        expect(failed).toEqual({ kind: 'retryable-error' });
        expect(beforeStart).not.toHaveBeenCalled();
        expect(startCloudBattle).not.toHaveBeenCalled();

        const attempt: CloudBattleAttempt = {
            battleAttemptId: 'attempt-next',
            actors: {
                player: { attack: 10, defense: 5, maxHp: 50 },
                enemy: { stage: 2, name: '敵', maxHp: 20, attack: 2, defense: 1, xpReward: 4 },
                playerLevel: 1,
                playerName: '勇者',
            },
        };
        await runCloudBattleStart(2, 'next-key', {
            getBattleAuthState: async () => ({ kind: 'authenticated', userId: 'user-1' }),
            startCloudBattleAttempt: async () => attempt,
            startBattle: vi.fn(),
            startCloudBattle,
        }, beforeStart);
        expect(beforeStart).toHaveBeenCalledTimes(1);
        expect(startCloudBattle).toHaveBeenCalledTimes(1);
    });
});
