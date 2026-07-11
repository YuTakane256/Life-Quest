import { describe, expect, it } from 'vitest';
import { filterAndSortInventory } from './inventory.ts';
import type { Equipment, EquipmentSlot } from './equipment.ts';

const slotLabels: Record<EquipmentSlot, string> = {
    weapon: '武器',
    armor: '防具',
    accessory: 'アクセサリー',
};

function item(overrides: Partial<Equipment> & Pick<Equipment, 'id' | 'name' | 'slot' | 'rarity'>): Equipment {
    return {
        templateId: overrides.id,
        attackBonus: 0,
        defenseBonus: 0,
        hpBonus: 0,
        equipped: false,
        ...overrides,
    };
}

describe('filterAndSortInventory', () => {
    const items: Equipment[] = [
        item({ id: 'a', name: 'あ武器', slot: 'weapon', rarity: 'common' }),
        item({ id: 'b', name: 'い防具', slot: 'armor', rarity: 'legendary' }),
        item({ id: 'c', name: 'う武器', slot: 'weapon', rarity: 'legendary' }),
        item({ id: 'd', name: 'えアクセ', slot: 'accessory', rarity: 'rare' }),
    ];

    it('レア順ソートは高レアリティ優先、同レアリティは名前順', () => {
        const result = filterAndSortInventory(items, { slotFilter: 'all', rarityFilter: 'all', sortMode: 'rarity', slotLabels });
        expect(result.map((i) => i.id)).toEqual(['b', 'c', 'd', 'a']);
    });

    it('種類順ソートはスロットラベルのja比較、同スロットは名前順', () => {
        const result = filterAndSortInventory(items, { slotFilter: 'all', rarityFilter: 'all', sortMode: 'slot', slotLabels });
        expect(result.map((i) => i.id)).toEqual(['d', 'a', 'c', 'b']);
    });

    it('名前順ソート', () => {
        const result = filterAndSortInventory(items, { slotFilter: 'all', rarityFilter: 'all', sortMode: 'name', slotLabels });
        expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('スロットフィルタで絞り込む', () => {
        const result = filterAndSortInventory(items, { slotFilter: 'weapon', rarityFilter: 'all', sortMode: 'name', slotLabels });
        expect(result.map((i) => i.id)).toEqual(['a', 'c']);
    });

    it('レアリティフィルタで絞り込む', () => {
        const result = filterAndSortInventory(items, { slotFilter: 'all', rarityFilter: 'legendary', sortMode: 'name', slotLabels });
        expect(result.map((i) => i.id)).toEqual(['b', 'c']);
    });

    it('元配列を変更しない', () => {
        const original = [...items];
        filterAndSortInventory(items, { slotFilter: 'all', rarityFilter: 'all', sortMode: 'rarity', slotLabels });
        expect(items).toEqual(original);
    });
});
