import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import type { ChestReward } from '../types';

function makeChest(overrides: Partial<ChestReward> = {}): ChestReward {
    return {
        id: 'c1',
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
        battle: {
            status: 'idle',
            currentStage: 1,
            maxClearedStage: 0,
            enemy: null,
            playerHp: 50,
            logs: [],
            battleUnlocked: false,
        },
        pendingChestReveal: null,
    });
}

describe('useGameStore.openChest', () => {
    beforeEach(() => {
        reset();
        // rollEquipment / generateId 内の Math.random を決定的にする
        vi.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('未開封 wood chest を開封すると chest.opened: true, equipment 配列に追加, pendingChestReveal 設定', () => {
        useGameStore.setState({ chestQueue: [makeChest({ id: 'c1', chestType: 'wood' })] });
        useGameStore.getState().openChest('c1');
        const state = useGameStore.getState();
        const chest = state.chestQueue.find((c) => c.id === 'c1');
        expect(chest?.opened).toBe(true);
        expect(chest?.equipment).not.toBeNull();
        // 装備配列に新規装備が追加されている（未装備で）
        expect(state.equipment).toHaveLength(1);
        expect(state.equipment[0].equipped).toBe(false);
        // pendingChestReveal がセットされている
        expect(state.pendingChestReveal).not.toBeNull();
        expect(state.pendingChestReveal?.chestId).toBe('c1');
        expect(state.pendingChestReveal?.chestType).toBe('wood');
        expect(state.pendingChestReveal?.isStarterCharacter).toBe(false);
    });

    it('既に opened の chest を再度開封しても state 変化なし', () => {
        const chest = makeChest({ id: 'c1', opened: true });
        useGameStore.setState({ chestQueue: [chest] });
        const before = useGameStore.getState();
        useGameStore.getState().openChest('c1');
        const after = useGameStore.getState();
        expect(after.chestQueue).toEqual(before.chestQueue);
        expect(after.equipment).toEqual(before.equipment);
        expect(after.pendingChestReveal).toBeNull();
    });

    it('存在しない chestId は no-op', () => {
        useGameStore.setState({ chestQueue: [makeChest({ id: 'c1' })] });
        const before = useGameStore.getState();
        useGameStore.getState().openChest('does-not-exist');
        expect(useGameStore.getState()).toEqual(before);
    });

    it('blue chest (スターターキャラ) は equipment は null, battleUnlocked: true, isStarterCharacter: true', () => {
        const chest = makeChest({
            id: 'c-blue',
            chestType: 'blue',
            label: '青色の宝箱',
            isStarterCharacter: true,
        });
        useGameStore.setState({ chestQueue: [chest] });
        useGameStore.getState().openChest('c-blue');
        const state = useGameStore.getState();
        const opened = state.chestQueue.find((c) => c.id === 'c-blue');
        expect(opened?.opened).toBe(true);
        expect(opened?.equipment).toBeNull();
        expect(state.equipment).toHaveLength(0); // null なので装備配列には追加されない
        expect(state.battle.battleUnlocked).toBe(true);
        expect(state.pendingChestReveal?.isStarterCharacter).toBe(true);
    });
});
