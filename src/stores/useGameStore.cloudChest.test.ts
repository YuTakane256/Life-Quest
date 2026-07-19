import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';
import { EQUIPMENT_POOL } from '@life-quest/core/rewards';
import type { ChestReward } from '../types';

function makeChest(overrides: Partial<ChestReward> = {}): ChestReward {
    return {
        id: 'chest-' + Math.random().toString(36).slice(2, 8),
        chestType: 'wood',
        label: '木の宝箱',
        opened: false,
        equipment: null,
        ...overrides,
    };
}

function reset() {
    localStorage.clear();
    useGameStore.setState({
        equipment: [],
        chestQueue: [],
        pendingChestReveal: null,
        battle: {
            status: 'idle',
            currentStage: 1,
            maxClearedStage: 0,
            enemy: null,
            playerHp: 50,
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
    });
}

const someTemplate = EQUIPMENT_POOL[0];

describe('useGameStore.applyCloudChestResult', () => {
    beforeEach(() => reset());

    it('サーバーのitemId/templateIdからequipmentを生成し、equipmentIdはサーバーのitem_idと一致する', () => {
        const chest = makeChest({ id: 'c1', chestType: 'wood' });
        useGameStore.setState({ chestQueue: [chest] });

        useGameStore.getState().applyCloudChestResult('c1', 'server-item-1', someTemplate.id, false);
        const state = useGameStore.getState();

        const openedChest = state.chestQueue.find((c) => c.id === 'c1');
        expect(openedChest?.opened).toBe(true);
        expect(openedChest?.equipment).not.toBeNull();

        expect(state.equipment).toHaveLength(1);
        expect(state.equipment[0].id).toBe('server-item-1');
        expect(state.equipment[0].templateId).toBe(someTemplate.id);
        expect(state.equipment[0].equipped).toBe(false);

        expect(state.pendingChestReveal).not.toBeNull();
        expect(state.pendingChestReveal!.chestId).toBe('c1');
        expect(state.pendingChestReveal!.equipment?.id).toBe('server-item-1');
    });

    it('templateId=null（blue宝箱等）はequipmentを生成しない', () => {
        const chest = makeChest({ id: 'c-blue', chestType: 'blue', isStarterCharacter: true });
        useGameStore.setState({ chestQueue: [chest] });

        useGameStore.getState().applyCloudChestResult('c-blue', null, null, true);
        const state = useGameStore.getState();

        expect(state.equipment).toHaveLength(0);
        expect(state.battle.battleUnlocked).toBe(true);
        expect(state.pendingChestReveal!.isStarterCharacter).toBe(true);
        expect(state.pendingChestReveal!.equipment).toBeNull();
    });

    it('未知のtemplateIdはequipmentを生成せずopenedだけ適用する', () => {
        const chest = makeChest({ id: 'c1' });
        useGameStore.setState({ chestQueue: [chest] });

        useGameStore.getState().applyCloudChestResult('c1', 'server-item-1', 'not-a-real-template', false);
        const state = useGameStore.getState();

        expect(state.equipment).toHaveLength(0);
        expect(state.chestQueue.find((c) => c.id === 'c1')?.opened).toBe(true);
        expect(state.pendingChestReveal!.equipment).toBeNull();
    });

    it('既に opened の chest には何もしない（冪等）', () => {
        const chest = makeChest({ id: 'c1', opened: true });
        useGameStore.setState({ chestQueue: [chest], pendingChestReveal: null });

        useGameStore.getState().applyCloudChestResult('c1', 'server-item-1', someTemplate.id, false);
        const state = useGameStore.getState();

        expect(state.equipment).toHaveLength(0);
        expect(state.pendingChestReveal).toBeNull();
    });

    it('存在しないchestIdには何もしない', () => {
        const chest = makeChest({ id: 'c1' });
        useGameStore.setState({ chestQueue: [chest], pendingChestReveal: null });

        useGameStore.getState().applyCloudChestResult('nonexistent', 'server-item-1', someTemplate.id, false);
        const state = useGameStore.getState();

        expect(state.chestQueue[0].opened).toBe(false);
        expect(state.equipment).toHaveLength(0);
        expect(state.pendingChestReveal).toBeNull();
    });
});

describe('useGameStore.discardSyncedChest', () => {
    beforeEach(() => reset());

    it('該当chestをopened扱いにする（演出・equipment無し）', () => {
        const chest = makeChest({ id: 'c1' });
        useGameStore.setState({ chestQueue: [chest], pendingChestReveal: null });

        useGameStore.getState().discardSyncedChest('c1');
        const state = useGameStore.getState();

        expect(state.chestQueue.find((c) => c.id === 'c1')?.opened).toBe(true);
        expect(state.equipment).toHaveLength(0);
        expect(state.pendingChestReveal).toBeNull();
    });
});
