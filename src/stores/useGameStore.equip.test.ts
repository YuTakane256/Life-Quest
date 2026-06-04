import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';
import type { Equipment } from '../types';

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
    useGameStore.setState({ equipment: [] });
}

describe('useGameStore.equipItem', () => {
    beforeEach(() => reset());

    it('未装備のアイテムを装備すると equipped: true になる', () => {
        const item = makeEquipment({ id: 'w1', equipped: false });
        useGameStore.setState({ equipment: [item] });

        useGameStore.getState().equipItem('w1');
        const updated = useGameStore.getState().equipment.find((e) => e.id === 'w1');
        expect(updated?.equipped).toBe(true);
    });

    it('同じスロットに既に装備中のアイテムがある場合、そちらが外れる (automatic swap)', () => {
        const item1 = makeEquipment({ id: 'w1', slot: 'weapon', equipped: true });
        const item2 = makeEquipment({ id: 'w2', slot: 'weapon', equipped: false });
        useGameStore.setState({ equipment: [item1, item2] });

        useGameStore.getState().equipItem('w2');
        const eq = useGameStore.getState().equipment;
        expect(eq.find((e) => e.id === 'w1')?.equipped).toBe(false);
        expect(eq.find((e) => e.id === 'w2')?.equipped).toBe(true);
    });

    it('別スロットの装備品は影響を受けない', () => {
        const weapon = makeEquipment({ id: 'w1', slot: 'weapon', equipped: true });
        const armor = makeEquipment({ id: 'a1', slot: 'armor', equipped: true });
        const newWeapon = makeEquipment({ id: 'w2', slot: 'weapon', equipped: false });
        useGameStore.setState({ equipment: [weapon, armor, newWeapon] });

        useGameStore.getState().equipItem('w2');
        const eq = useGameStore.getState().equipment;
        expect(eq.find((e) => e.id === 'a1')?.equipped).toBe(true); // armor は維持
        expect(eq.find((e) => e.id === 'w2')?.equipped).toBe(true);
        expect(eq.find((e) => e.id === 'w1')?.equipped).toBe(false);
    });

    it('存在しない id は no-op', () => {
        const item = makeEquipment({ id: 'w1', equipped: false });
        useGameStore.setState({ equipment: [item] });
        const before = useGameStore.getState().equipment;

        useGameStore.getState().equipItem('nonexistent');
        expect(useGameStore.getState().equipment).toEqual(before);
    });
});

describe('useGameStore.unequipItem', () => {
    beforeEach(() => reset());

    it('装備中のアイテムを外す → equipped: false', () => {
        const item = makeEquipment({ id: 'w1', equipped: true });
        useGameStore.setState({ equipment: [item] });

        useGameStore.getState().unequipItem('w1');
        expect(useGameStore.getState().equipment.find((e) => e.id === 'w1')?.equipped).toBe(false);
    });

    it('未装備のアイテムでも安全 (state 変化なし)', () => {
        const item = makeEquipment({ id: 'w1', equipped: false });
        useGameStore.setState({ equipment: [item] });

        useGameStore.getState().unequipItem('w1');
        expect(useGameStore.getState().equipment.find((e) => e.id === 'w1')?.equipped).toBe(false);
    });

    it('存在しない id は no-op', () => {
        const item = makeEquipment({ id: 'w1', equipped: true });
        useGameStore.setState({ equipment: [item] });
        const before = useGameStore.getState().equipment;

        useGameStore.getState().unequipItem('nonexistent');
        expect(useGameStore.getState().equipment).toEqual(before);
    });
});
