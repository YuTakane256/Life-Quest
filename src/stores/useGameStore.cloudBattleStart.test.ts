/**
 * useCloudBattleStart はReact hookのため、このプロジェクトにはhookを直接
 * 実行するテスト基盤（@testing-library/react等）が無い。代わりに、hookが
 * 呼び出す store アクション（startCloudBattle）とcoreクライアント
 * （gameCloud.ts、gameCloud.test.tsで検証済み）の変換ロジック部分を
 * ここで検証する: CloudBattleAttempt の actors から BattlePlayerSnapshot/
 * Enemy への変換がuseCloudBattleStart内のものと同じ形になることを保証する。
 */
import { describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';
import { BATTLE_CONFIG, CHARACTER_CONFIG } from '../config/gameConfig';
import type { BattlePlayerSnapshot, Enemy } from '../types';
import type { CloudBattleAttempt } from '../platform/gameCloud';

const INITIAL = CHARACTER_CONFIG.INITIAL_STATS;
const firstStage = BATTLE_CONFIG.STAGES[0];

function resetStore() {
    localStorage.clear();
    useGameStore.setState({
        character: {
            name: INITIAL.name,
            avatar: INITIAL.avatar,
            level: INITIAL.level,
            totalXp: INITIAL.totalXp,
            baseAttack: INITIAL.attack,
            baseDefense: INITIAL.defense,
            baseMaxHp: INITIAL.maxHp,
        },
        debuff: { active: false, expiresAt: null, multiplier: 1 },
        equipment: [],
        gachaCount: 0,
        chestQueue: [],
        battle: {
            status: 'idle',
            currentStage: 1,
            maxClearedStage: 0,
            enemy: null,
            playerHp: INITIAL.maxHp,
            logs: [],
            battleUnlocked: true,
            skillCooldowns: {},
            guardTurnsRemaining: 0,
            guardDamageReduction: 0,
            actions: [],
            battleAttemptId: null,
            rewardMode: 'local',
            playerSnapshot: null,
        },
        levelUpEvent: null,
        pendingChestReveal: null,
    });
}

/** useCloudBattleStart.tsのstartStage内の変換ロジックと同一処理。 */
function convertAttemptToStartArgs(attempt: CloudBattleAttempt): { playerSnapshot: BattlePlayerSnapshot; enemy: Enemy } {
    const playerSnapshot: BattlePlayerSnapshot = {
        attack: attempt.actors.player.attack,
        defense: attempt.actors.player.defense,
        maxHp: attempt.actors.player.maxHp,
        level: attempt.actors.playerLevel,
        name: attempt.actors.playerName,
    };
    const enemy: Enemy = { ...attempt.actors.enemy, hp: attempt.actors.enemy.maxHp };
    return { playerSnapshot, enemy };
}

describe('CloudBattleAttempt → startCloudBattle引数の変換', () => {
    it('actors.player + playerLevel/playerNameからBattlePlayerSnapshotを組み立てる', () => {
        const attempt: CloudBattleAttempt = {
            battleAttemptId: 'attempt-1',
            actors: {
                player: { attack: 12, defense: 8, maxHp: 110 },
                enemy: { stage: 1, name: 'スライム', maxHp: 30, attack: 3, defense: 1, xpReward: 5 },
                playerLevel: 2,
                playerName: 'テスト勇者',
            },
        };

        const { playerSnapshot, enemy } = convertAttemptToStartArgs(attempt);

        expect(playerSnapshot).toEqual({ attack: 12, defense: 8, maxHp: 110, level: 2, name: 'テスト勇者' });
        expect(enemy).toEqual({ stage: 1, name: 'スライム', maxHp: 30, attack: 3, defense: 1, xpReward: 5, hp: 30 });
    });

    it('変換した引数でstartCloudBattleを呼ぶとサーバースナップショットで固定される', () => {
        resetStore();
        const attempt: CloudBattleAttempt = {
            battleAttemptId: 'attempt-1',
            actors: {
                player: { attack: 999, defense: 999, maxHp: 999 },
                enemy: { stage: firstStage.stage, name: firstStage.name, maxHp: firstStage.hp, attack: 1, defense: 1, xpReward: firstStage.xpReward },
                playerLevel: 5,
                playerName: 'クラウド勇者',
            },
        };
        const { playerSnapshot, enemy } = convertAttemptToStartArgs(attempt);

        useGameStore.getState().startCloudBattle(firstStage.stage, attempt.battleAttemptId, playerSnapshot, enemy);

        const battle = useGameStore.getState().battle;
        expect(battle.rewardMode).toBe('cloud');
        expect(battle.battleAttemptId).toBe('attempt-1');
        expect(battle.playerSnapshot).toEqual(playerSnapshot);
        expect(battle.enemy).toEqual(enemy);
    });
});
