import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';
import { BATTLE_CONFIG, CHARACTER_CONFIG } from '../config/gameConfig';

const INITIAL = CHARACTER_CONFIG.INITIAL_STATS;
const firstStage = BATTLE_CONFIG.STAGES[0];
const lastStage = BATTLE_CONFIG.STAGES[BATTLE_CONFIG.STAGES.length - 1];

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
            battleUnlocked: false,
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

describe('useGameStore battle start guards', () => {
    beforeEach(() => {
        resetStore();
    });

    it('does not start a battle before battle mode is unlocked', () => {
        useGameStore.getState().startBattle(firstStage.stage);

        expect(useGameStore.getState().battle).toMatchObject({
            status: 'idle',
            enemy: null,
            currentStage: 1,
            battleUnlocked: false,
        });
    });

    it('starts the first reachable stage after battle mode is unlocked', () => {
        useGameStore.setState((state) => ({
            battle: { ...state.battle, battleUnlocked: true },
        }));

        useGameStore.getState().startBattle(firstStage.stage);

        expect(useGameStore.getState().battle).toMatchObject({
            status: 'fighting',
            currentStage: firstStage.stage,
            playerHp: INITIAL.maxHp,
        });
        expect(useGameStore.getState().battle.enemy).toMatchObject({
            stage: firstStage.stage,
            name: firstStage.name,
            hp: firstStage.hp,
            maxHp: firstStage.hp,
        });
    });

    it('rejects stages beyond the next uncleared stage', () => {
        useGameStore.setState((state) => ({
            battle: { ...state.battle, battleUnlocked: true, maxClearedStage: 0 },
        }));

        useGameStore.getState().startBattle(2);

        expect(useGameStore.getState().battle).toMatchObject({
            status: 'idle',
            enemy: null,
            currentStage: 1,
        });
    });

    it('allows the next stage after cleared progress', () => {
        useGameStore.setState((state) => ({
            battle: { ...state.battle, battleUnlocked: true, maxClearedStage: 10, currentStage: 10 },
        }));

        useGameStore.getState().startBattle(11);

        expect(useGameStore.getState().battle).toMatchObject({
            status: 'fighting',
            currentStage: 11,
        });
        expect(useGameStore.getState().battle.enemy?.stage).toBe(11);
    });

    it('rejects invalid stage numbers even when battle mode is unlocked', () => {
        useGameStore.setState((state) => ({
            battle: { ...state.battle, battleUnlocked: true, maxClearedStage: lastStage.stage },
        }));

        useGameStore.getState().startBattle(lastStage.stage + 1);
        useGameStore.getState().startBattle(1.5);
        useGameStore.getState().startBattle(0);

        expect(useGameStore.getState().battle).toMatchObject({
            status: 'idle',
            enemy: null,
            currentStage: 1,
        });
    });
});

describe('useGameStore battle skills', () => {
    beforeEach(() => {
        resetStore();
        useGameStore.setState((state) => ({
            battle: { ...state.battle, battleUnlocked: true },
        }));
    });

    it('uses an unlocked damage skill and starts its cooldown', () => {
        useGameStore.getState().startBattle(firstStage.stage);

        const used = useGameStore.getState().activateBattleSkill('power_strike');
        const battle = useGameStore.getState().battle;

        expect(used).toBe(true);
        expect(battle.enemy?.hp).toBeLessThan(firstStage.hp);
        expect(battle.logs[0]?.message).toContain('強撃');
        expect(battle.skillCooldowns.power_strike).toBeGreaterThan(0);
    });

    it('rejects locked skills', () => {
        useGameStore.getState().startBattle(firstStage.stage);

        expect(useGameStore.getState().activateBattleSkill('first_aid')).toBe(false);
        expect(useGameStore.getState().battle.logs).toHaveLength(0);
    });

    it('uses heal skills when HP is missing', () => {
        useGameStore.setState((state) => ({
            character: { ...state.character, level: 3, baseMaxHp: 70 },
        }));
        useGameStore.getState().startBattle(firstStage.stage);
        useGameStore.setState((state) => ({
            battle: { ...state.battle, playerHp: 10 },
        }));

        const used = useGameStore.getState().activateBattleSkill('first_aid');

        expect(used).toBe(true);
        expect(useGameStore.getState().battle.playerHp).toBeGreaterThan(10);
        expect(useGameStore.getState().battle.logs[0]?.message).toContain('応急手当');
    });

    it('uses guard skills to reduce the next enemy attack', () => {
        useGameStore.setState((state) => ({
            character: { ...state.character, level: 5 },
        }));
        useGameStore.getState().startBattle(firstStage.stage);
        useGameStore.setState((state) => ({
            battle: {
                ...state.battle,
                enemy: state.battle.enemy ? { ...state.battle.enemy, attack: 20 } : null,
            },
        }));

        const used = useGameStore.getState().activateBattleSkill('guard_stance');
        const battle = useGameStore.getState().battle;

        expect(used).toBe(true);
        expect(battle.playerHp).toBeGreaterThan(INITIAL.maxHp - 18);
        expect(battle.logs.some((log) => log.message.includes('防御効果で軽減'))).toBe(true);
        expect(battle.guardTurnsRemaining).toBe(1);
    });
});

describe('useGameStore battle identity', () => {
    beforeEach(() => {
        resetStore();
        useGameStore.setState((state) => ({
            character: { ...state.character, name: 'アルテミス' },
            battle: { ...state.battle, battleUnlocked: true },
        }));
    });

    it('uses the configured character name in regular battle logs', () => {
        useGameStore.getState().startBattle(firstStage.stage);
        useGameStore.getState().processBattleTurn();

        const messages = useGameStore.getState().battle.logs.map((log) => log.message);
        expect(messages[0]).toContain('アルテミスの攻撃');
        expect(messages[1]).toContain('アルテミスに');
        expect(messages.join(' ')).not.toContain('あなた');
    });

    it('uses the configured character name when a skill triggers an enemy attack', () => {
        useGameStore.getState().startBattle(firstStage.stage);
        useGameStore.getState().activateBattleSkill('power_strike');

        const logs = useGameStore.getState().battle.logs;
        expect(logs[logs.length - 1]?.message).toContain('アルテミスに');
    });
});
