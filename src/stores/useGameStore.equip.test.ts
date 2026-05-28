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
    beforeEach(() => {
        reset();
    });

    it('未装備のアイテムを装備すると equipped: true になる', () => {
        const item = makeEquipment({ id: 'w1' });
        useGameStore.setState({ equipment: [item] });
        useGameStore.getState().equipItem('w1');
        expect(useGameStore.getState().equipment.find((e) => e.id === 'w1')?.equipped).toBe(true);
    });

    it('同スロットに装備中のアイテムが既にあれば自動で外れる (swap)', () => {
        const wOld = makeEquipment({ id: 'w-old', slot: 'weapon', equipped: true });
        const wNew = makeEquipment({ id: 'w-new', slot: 'weapon', equipped: false });
        useGameStore.setState({ equipment: [wOld, wNew] });
        useGameStore.getState().equipItem('w-new');
        const eq = useGameStore.getState().equipment;
        expect(eq.find((e) => e.id === 'w-old')?.equipped).toBe(false);
        expect(eq.find((e) => e.id === 'w-new')?.equipped).toBe(true);
    });

    it('別スロットの装備品は影響を受けない', () => {
        const w = makeEquipment({ id: 'w', slot: 'weapon', equipped: true });
        const a = makeEquipment({ id: 'a', slot: 'armor', equipped: true });
        const wNext = makeEquipment({ id: 'w2', slot: 'weapon', equipped: false });
        useGameStore.setState({ equipment: [w, a, wNext] });
        useGameStore.getState().equipItem('w2');
        const eq = useGameStore.getState().equipment;
        expect(eq.find((e) => e.id === 'w')?.equipped).toBe(false); // 同スロットは外れる
        expect(eq.find((e) => e.id === 'a')?.equipped).toBe(true);  // 別スロットは維持
        expect(eq.find((e) => e.id === 'w2')?.equipped).toBe(true);
    });

    it('存在しない id を渡すと state 変化なし', () => {
        const w = makeEquipment({ id: 'w', equipped: false });
        useGameStore.setState({ equipment: [w] });
        const before = useGameStore.getState().equipment;
        useGameStore.getState().equipItem('does-not-exist');
        // equipped フラグも何も変わらない
        expect(useGameStore.getState().equipment[0]).toEqual(before[0]);
    });
});

describe('useGameStore.unequipItem', () => {
    beforeEach(() => {
        reset();
    });

    it('装備中のアイテムを外す → equipped: false', () => {
        const w = makeEquipment({ id: 'w', equipped: true });
        useGameStore.setState({ equipment: [w] });
        useGameStore.getState().unequipItem('w');
        expect(useGameStore.getState().equipment[0].equipped).toBe(false);
    });

    it('未装備のアイテムでも安全（state 変化なし）', () => {
        const w = makeEquipment({ id: 'w', equipped: false });
        useGameStore.setState({ equipment: [w] });
        useGameStore.getState().unequipItem('w');
        expect(useGameStore.getState().equipment[0].equipped).toBe(false);
    });

    it('存在しない id を渡しても他要素に影響なし', () => {
        const w = makeEquipment({ id: 'w', equipped: true });
        useGameStore.setState({ equipment: [w] });
        useGameStore.getState().unequipItem('nope');
        expect(useGameStore.getState().equipment[0].equipped).toBe(true);
    });
});
