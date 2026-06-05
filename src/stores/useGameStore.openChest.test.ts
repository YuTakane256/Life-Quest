import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
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
    // Math.random を固定して装備生成を決定論的にする
    vi.spyOn(Math, 'random').mockReturnValue(0);
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
        },
    });
}

describe('useGameStore.openChest', () => {
    beforeEach(() => reset());
    afterEach(() => vi.restoreAllMocks());

    it('未開封 wood chest を開封: opened=true, equipment追加, pendingChestReveal セット', () => {
        const chest = makeChest({ id: 'c1', chestType: 'wood' });
        useGameStore.setState({ chestQueue: [chest] });

        useGameStore.getState().openChest('c1');
        const state = useGameStore.getState();

        // chest が opened になっている
        const openedChest = state.chestQueue.find((c) => c.id === 'c1');
        expect(openedChest?.opened).toBe(true);
        expect(openedChest?.equipment).not.toBeNull();

        // equipment 配列に新装備が追加
        expect(state.equipment.length).toBe(1);
        expect(state.equipment[0].equipped).toBe(false);

        // pendingChestReveal がセットされている
        expect(state.pendingChestReveal).not.toBeNull();
        expect(state.pendingChestReveal!.chestId).toBe('c1');
        expect(state.pendingChestReveal!.chestType).toBe('wood');
        expect(state.pendingChestReveal!.equipment).not.toBeNull();
    });

    it('既に opened の chest を再度 openChest: state 変化なし', () => {
        const chest = makeChest({ id: 'c1', opened: true, equipment: null });
        useGameStore.setState({ chestQueue: [chest], pendingChestReveal: null });

        useGameStore.getState().openChest('c1');
        const state = useGameStore.getState();
        expect(state.equipment).toHaveLength(0);
        expect(state.pendingChestReveal).toBeNull();
    });

    it('存在しない chestId: state 変化なし', () => {
        const chest = makeChest({ id: 'c1' });
        useGameStore.setState({ chestQueue: [chest], pendingChestReveal: null });

        useGameStore.getState().openChest('nonexistent');
        const state = useGameStore.getState();
        expect(state.chestQueue[0].opened).toBe(false);
        expect(state.equipment).toHaveLength(0);
        expect(state.pendingChestReveal).toBeNull();
    });

    it('blue chest (スターターキャラ): equipment=null, battleUnlocked=true', () => {
        const chest = makeChest({ id: 'c-blue', chestType: 'blue', isStarterCharacter: true });
        useGameStore.setState({ chestQueue: [chest] });

        useGameStore.getState().openChest('c-blue');
        const state = useGameStore.getState();

        // blue chest は equipment を生成しない
        expect(state.equipment).toHaveLength(0);

        // バトルが解放される
        expect(state.battle.battleUnlocked).toBe(true);

        // pendingChestReveal にスターター情報
        expect(state.pendingChestReveal).not.toBeNull();
        expect(state.pendingChestReveal!.isStarterCharacter).toBe(true);
        expect(state.pendingChestReveal!.equipment).toBeNull();
    });
});
