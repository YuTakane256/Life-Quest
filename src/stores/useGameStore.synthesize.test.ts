import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';
import type { Equipment, EquipmentSlot, Rarity } from '../types';

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
    const slot = overrides.slot ?? 'weapon';
    const rarity = overrides.rarity ?? 'common';
    return {
        id: 'eq-' + Math.random().toString(36).slice(2, 8),
        templateId: slot === 'armor' ? 'leather_armor' : slot === 'accessory' ? 'wooden_ring' : 'wooden_sword',
        name: slot === 'armor' ? '革の鎧' : slot === 'accessory' ? '木の指輪' : '木の剣',
        slot,
        rarity,
        attackBonus: slot === 'weapon' ? 2 : 0,
        defenseBonus: slot === 'armor' ? 2 : 0,
        hpBonus: slot === 'accessory' ? 3 : 0,
        equipped: false,
        ...overrides,
    };
}

function setEquipment(items: Equipment[]) {
    useGameStore.setState({ equipment: items });
}

function currentEquipmentIds() {
    return useGameStore.getState().equipment.map((item) => item.id);
}

describe('useGameStore.synthesizeItems', () => {
    beforeEach(() => {
        localStorage.clear();
        setEquipment([]);
    });

    it('重複IDを素材数として数えず、無料アップグレードを拒否する', () => {
        const item = makeEquipment({ id: 'same-id' });
        setEquipment([item]);

        const result = useGameStore.getState().synthesizeItems(['same-id', 'same-id', 'same-id']);

        expect(result).toBeNull();
        expect(useGameStore.getState().equipment).toEqual([item]);
    });

    it('素材IDが3件ちょうどでなければ拒否する', () => {
        const items = [
            makeEquipment({ id: 'w1' }),
            makeEquipment({ id: 'w2' }),
            makeEquipment({ id: 'w3' }),
            makeEquipment({ id: 'w4' }),
        ];
        setEquipment(items);

        expect(useGameStore.getState().synthesizeItems(['w1', 'w2'])).toBeNull();
        expect(useGameStore.getState().synthesizeItems(['w1', 'w2', 'w3', 'w4'])).toBeNull();
        expect(useGameStore.getState().equipment).toEqual(items);
    });

    it('存在しないIDが混ざっている場合は拒否する', () => {
        const items = [makeEquipment({ id: 'w1' }), makeEquipment({ id: 'w2' })];
        setEquipment(items);

        const result = useGameStore.getState().synthesizeItems(['w1', 'w2', 'missing']);

        expect(result).toBeNull();
        expect(useGameStore.getState().equipment).toEqual(items);
    });

    it.each([
        ['レアリティが揃わない', [
            makeEquipment({ id: 'w1', rarity: 'common' }),
            makeEquipment({ id: 'w2', rarity: 'common' }),
            makeEquipment({ id: 'w3', rarity: 'uncommon' }),
        ]],
        ['装備中の素材が含まれる', [
            makeEquipment({ id: 'w1', equipped: false }),
            makeEquipment({ id: 'w2', equipped: true }),
            makeEquipment({ id: 'w3', equipped: false }),
        ]],
        ['legendary は合成できない', [
            makeEquipment({ id: 'w1', rarity: 'legendary' }),
            makeEquipment({ id: 'w2', rarity: 'legendary' }),
            makeEquipment({ id: 'w3', rarity: 'legendary' }),
        ]],
    ] satisfies [string, Equipment[]][])('%s場合は拒否する', (_label, items) => {
        setEquipment(items);

        const result = useGameStore.getState().synthesizeItems(items.map((item) => item.id));

        expect(result).toBeNull();
        expect(useGameStore.getState().equipment).toEqual(items);
    });

    it('正常系では素材だけを消費し、多数派スロットの次レア装備を追加する', () => {
        const ingredients = [
            makeEquipment({ id: 'armor-1', slot: 'armor' }),
            makeEquipment({ id: 'armor-2', slot: 'armor' }),
            makeEquipment({ id: 'weapon-1', slot: 'weapon' }),
        ];
        const unrelated = makeEquipment({ id: 'keep', slot: 'accessory' });
        setEquipment([...ingredients, unrelated]);

        const result = useGameStore.getState().synthesizeItems(ingredients.map((item) => item.id));
        const equipment = useGameStore.getState().equipment;

        expect(result).toMatchObject({
            templateId: 'chain_mail',
            slot: 'armor' satisfies EquipmentSlot,
            rarity: 'uncommon' satisfies Rarity,
            equipped: false,
        });
        expect(currentEquipmentIds()).not.toEqual(expect.arrayContaining(ingredients.map((item) => item.id)));
        expect(equipment).toHaveLength(2);
        expect(equipment.find((item) => item.id === 'keep')).toEqual(unrelated);
        expect(equipment.find((item) => item.id === result?.id)).toEqual(result);
    });
});
