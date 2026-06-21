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
