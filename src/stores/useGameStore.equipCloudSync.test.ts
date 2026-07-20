import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { enqueueCloudOperation } from '../platform/cloudOutbox';
import type { Equipment } from '../types';

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async () => true),
    isWebCloudOutboxActive: vi.fn(() => true),
}));

const enqueueMock = vi.mocked(enqueueCloudOperation);

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
    return {
        id: 'eq-' + Math.random().toString(36).slice(2, 8),
        templateId: 'wooden_sword',
        name: '木の剣',
        slot: 'weapon',
        rarity: 'common',
        attackBonus: 2,
        defenseBonus: 0,
        hpBonus: 0,
        equipped: false,
        ...overrides,
    };
}

function reset() {
    localStorage.clear();
    enqueueMock.mockClear();
    useGameStore.setState({ equipment: [] });
}

describe('useGameStore 装備装着のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => vi.clearAllMocks());

    it('equipItem: 装着後の装着中ID集合をset_equipped_itemsでenqueueする', () => {
        useGameStore.setState({ equipment: [makeEquipment({ id: 'w1', equipped: false })] });

        useGameStore.getState().equipItem('w1');

        expect(enqueueMock).toHaveBeenCalledWith('set_equipped_items', { p_item_ids: ['w1'] });
    });

    it('equipItem: 同スロットの既存装備が外れた結果を反映する', () => {
        useGameStore.setState({
            equipment: [
                makeEquipment({ id: 'w1', slot: 'weapon', equipped: true }),
                makeEquipment({ id: 'w2', slot: 'weapon', equipped: false }),
            ],
        });

        useGameStore.getState().equipItem('w2');

        expect(enqueueMock).toHaveBeenCalledWith('set_equipped_items', { p_item_ids: ['w2'] });
    });

    it('unequipItem: 解除後の装着中ID集合をenqueueする', () => {
        useGameStore.setState({
            equipment: [
                makeEquipment({ id: 'w1', equipped: true }),
                makeEquipment({ id: 'a1', slot: 'armor', equipped: true }),
            ],
        });

        useGameStore.getState().unequipItem('w1');

        expect(enqueueMock).toHaveBeenCalledWith('set_equipped_items', { p_item_ids: ['a1'] });
    });

    it('存在しないIDのequipItemはno-opでenqueueもしない', () => {
        useGameStore.setState({ equipment: [makeEquipment({ id: 'w1', equipped: true })] });

        useGameStore.getState().equipItem('nonexistent');

        expect(enqueueMock).not.toHaveBeenCalled();
    });

    it('autoEquipBest: 変更があった場合のみenqueueする', () => {
        useGameStore.setState({
            equipment: [
                makeEquipment({ id: 'weak', slot: 'weapon', attackBonus: 1, equipped: true }),
                makeEquipment({ id: 'strong', slot: 'weapon', attackBonus: 10, equipped: false }),
            ],
        });

        const changed = useGameStore.getState().autoEquipBest();

        expect(changed).toBe(true);
        expect(enqueueMock).toHaveBeenCalledWith('set_equipped_items', { p_item_ids: ['strong'] });
    });

    it('autoEquipBest: 既に最強装備済みならenqueueしない', () => {
        useGameStore.setState({
            equipment: [makeEquipment({ id: 'only', slot: 'weapon', equipped: true })],
        });

        const changed = useGameStore.getState().autoEquipBest();

        expect(changed).toBe(false);
        expect(enqueueMock).not.toHaveBeenCalled();
    });
});
