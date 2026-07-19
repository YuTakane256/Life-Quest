import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore, sanitizeGameStoreState } from './useGameStore';
import { BATTLE_CONFIG, CHARACTER_CONFIG } from '../config/gameConfig';
import type { BattlePlayerSnapshot } from '../types';
import type { Enemy } from '../types';

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

const snapshot: BattlePlayerSnapshot = {
    attack: 999,
    defense: 999,
    maxHp: 999,
    level: 1,
    name: 'テスト勇者',
};

const enemy: Enemy = {
    stage: firstStage.stage,
    name: firstStage.name,
    hp: 1, // 1撃で倒せるようにしてテストを短くする
    maxHp: firstStage.hp,
    attack: 1,
    defense: 1,
    xpReward: firstStage.xpReward,
};

describe('useGameStore startCloudBattle', () => {
    beforeEach(() => resetStore());

    it('サーバーのスナップショットで固定し、rewardModeをcloudにする', () => {
        useGameStore.getState().startCloudBattle(firstStage.stage, 'attempt-1', snapshot, enemy);

        const battle = useGameStore.getState().battle;
        expect(battle.status).toBe('fighting');
        expect(battle.rewardMode).toBe('cloud');
        expect(battle.battleAttemptId).toBe('attempt-1');
        expect(battle.playerSnapshot).toEqual(snapshot);
        expect(battle.enemy).toEqual(enemy);
        expect(battle.actions).toEqual([]);
    });

    it('進行ロックはローカル開始と同様に適用される', () => {
        useGameStore.setState((state) => ({ battle: { ...state.battle, maxClearedStage: 0 } }));
        useGameStore.getState().startCloudBattle(5, 'attempt-1', snapshot, enemy);

        expect(useGameStore.getState().battle.status).toBe('idle');
    });
});

describe('useGameStore processBattleTurn（クラウドモード）', () => {
    beforeEach(() => resetStore());

    it('actionsを蓄積し、勝敗が決まってもrewardModeがcloudならXP・履歴を即時付与しない', () => {
        useGameStore.getState().startCloudBattle(firstStage.stage, 'attempt-1', snapshot, enemy);
        const xpBefore = useGameStore.getState().character.totalXp;

        useGameStore.getState().processBattleTurn();

        const battle = useGameStore.getState().battle;
        expect(battle.status).toBe('victory');
        expect(battle.actions).toEqual([{ type: 'attack' }]);
        expect(useGameStore.getState().character.totalXp).toBe(xpBefore); // まだ付与されない
    });
});

describe('useGameStore applyResolvedCloudBattle', () => {
    beforeEach(() => resetStore());

    it('granted:trueなら勝利時にXPとmaxClearedStageを反映する', () => {
        useGameStore.getState().startCloudBattle(firstStage.stage, 'attempt-1', snapshot, enemy);
        useGameStore.getState().processBattleTurn(); // 勝利させる
        const xpBefore = useGameStore.getState().character.totalXp;

        useGameStore.getState().applyResolvedCloudBattle('attempt-1', 'victory', true);

        expect(useGameStore.getState().character.totalXp).toBe(xpBefore + enemy.xpReward);
        expect(useGameStore.getState().battle.maxClearedStage).toBe(firstStage.stage);
    });

    it('granted:falseなら（再送で既に付与済み等）XPを重複付与しない', () => {
        useGameStore.getState().startCloudBattle(firstStage.stage, 'attempt-1', snapshot, enemy);
        useGameStore.getState().processBattleTurn();
        const xpBefore = useGameStore.getState().character.totalXp;

        useGameStore.getState().applyResolvedCloudBattle('attempt-1', 'victory', false);

        expect(useGameStore.getState().character.totalXp).toBe(xpBefore);
        // 進行度は結果が勝利である限り反映してよい
        expect(useGameStore.getState().battle.maxClearedStage).toBe(firstStage.stage);
    });

    it('別バトルへ遷移済み（attemptId不一致）なら結果を無視する', () => {
        useGameStore.getState().startCloudBattle(firstStage.stage, 'attempt-1', snapshot, enemy);
        useGameStore.getState().resetBattle(); // 離脱してattemptIdをクリア
        const xpBefore = useGameStore.getState().character.totalXp;
        const maxClearedBefore = useGameStore.getState().battle.maxClearedStage;

        useGameStore.getState().applyResolvedCloudBattle('attempt-1', 'victory', true);

        expect(useGameStore.getState().character.totalXp).toBe(xpBefore);
        expect(useGameStore.getState().battle.maxClearedStage).toBe(maxClearedBefore);
    });

    it('defeatならXP付与も進行度更新もしない', () => {
        useGameStore.getState().startCloudBattle(firstStage.stage, 'attempt-1', snapshot, enemy);
        const xpBefore = useGameStore.getState().character.totalXp;

        useGameStore.getState().applyResolvedCloudBattle('attempt-1', 'defeat', false);

        expect(useGameStore.getState().character.totalXp).toBe(xpBefore);
        expect(useGameStore.getState().battle.maxClearedStage).toBe(0);
    });
});

describe('離脱時のクラウド属性リセット', () => {
    beforeEach(() => resetStore());

    it('resetBattleでbattleAttemptId/rewardMode/actionsがリセットされる', () => {
        useGameStore.getState().startCloudBattle(firstStage.stage, 'attempt-1', snapshot, enemy);
        useGameStore.getState().processBattleTurn();

        useGameStore.getState().resetBattle();

        const battle = useGameStore.getState().battle;
        expect(battle.battleAttemptId).toBeNull();
        expect(battle.rewardMode).toBe('local');
        expect(battle.actions).toEqual([]);
        expect(battle.playerSnapshot).toBeNull();
    });

    it('advanceStageでもクラウド属性がリセットされる', () => {
        useGameStore.getState().startCloudBattle(firstStage.stage, 'attempt-1', snapshot, enemy);
        useGameStore.getState().processBattleTurn();

        useGameStore.getState().advanceStage();

        const battle = useGameStore.getState().battle;
        expect(battle.battleAttemptId).toBeNull();
        expect(battle.rewardMode).toBe('local');
    });

    it('sanitizeGameStoreState（永続化からの復元）は常にローカル・attemptIdなしへ落とす', () => {
        const sanitized = sanitizeGameStoreState({
            battle: {
                status: 'fighting',
                currentStage: 1,
                maxClearedStage: 0,
                enemy: { stage: 1, name: 'x', hp: 1, maxHp: 1, attack: 1, defense: 1, xpReward: 1 },
                playerHp: 10,
                logs: [],
                battleUnlocked: true,
                skillCooldowns: {},
                guardTurnsRemaining: 0,
                guardDamageReduction: 0,
                actions: [{ type: 'attack' }],
                battleAttemptId: 'stale-attempt',
                rewardMode: 'cloud',
                playerSnapshot: { attack: 1, defense: 1, maxHp: 1, level: 1, name: 'x' },
            },
        });

        expect(sanitized.battle.battleAttemptId).toBeNull();
        expect(sanitized.battle.rewardMode).toBe('local');
        expect(sanitized.battle.actions).toEqual([]);
        expect(sanitized.battle.playerSnapshot).toBeNull();
    });
});
