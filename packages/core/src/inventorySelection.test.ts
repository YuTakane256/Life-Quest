import { describe, expect, it } from 'vitest';
import { createEquipmentFromTemplate, type Equipment } from './equipment.ts';
import { reconcileSynthesisSelection, toggleSynthesisSelection } from './inventory.ts';
import { EQUIPMENT_POOL } from './rewards.ts';

const items = (): Equipment[] => Array.from({ length: 5 }, (_, index) => createEquipmentFromTemplate(`item-${index}`, EQUIPMENT_POOL.find((item) => item.id === 'wooden_sword')!));

describe('synthesis selection snapshots', () => {
    it('copies selected values and rejects later mutation', () => {
        const inventory = items(); const selected = toggleSynthesisSelection([], inventory[0], inventory, 3);
        expect(selected[0]).not.toBe(inventory[0]); inventory[0].attackBonus++;
        expect(reconcileSynthesisSelection(selected, inventory)).toEqual([]);
    });
    it.each(Object.keys(items()[0]) as (keyof Equipment)[])('drops changed %s, not an unrelated valid material', (key) => {
        const inventory = items(); const selected = inventory.slice(0, 2).map((item) => ({ ...item }));
        inventory[0] = { ...inventory[0], [key]: key === 'equipped' ? true : 'changed' } as Equipment;
        expect(reconcileSynthesisSelection(selected, inventory)).toEqual([selected[1]]);
    });
    it('allows equal pull, reordered inventory and unrelated loot; returns original selection identity', () => {
        const inventory = items(); const selected = inventory.slice(0, 2).map((item) => ({ ...item }));
        expect(reconcileSynthesisSelection(selected, inventory.map((item) => ({ ...item })).reverse())).toBe(selected);
    });
    it('prunes deleted / duplicate materials and refuses a stale candidate', () => {
        const inventory = items(); const selected = [inventory[0], inventory[0], inventory[1]].map((item) => ({ ...item }));
        expect(reconcileSynthesisSelection(selected, inventory.slice(1))).toEqual([selected[2]]);
        const old = { ...inventory[2] }; inventory[2].name = 'changed';
        expect(toggleSynthesisSelection([], old, inventory, 3)).toEqual([]);
    });
    it('limits to three, permits explicit deselection, enforces one rarity and excludes equipped / legendary', () => {
        const inventory = items(); let selected: readonly Equipment[] = [];
        for (const item of inventory) selected = toggleSynthesisSelection(selected, item, inventory, 3);
        expect(selected).toHaveLength(3);
        selected = toggleSynthesisSelection(selected, inventory[0], inventory, 3); expect(selected).toHaveLength(2);
        for (const updates of [{ equipped: true }, { rarity: 'uncommon' as const }, { rarity: 'legendary' as const }]) {
            const changed = { ...inventory[4], ...updates };
            expect(toggleSynthesisSelection(selected, changed, [...inventory.slice(0, 4), changed], 3)).toBe(selected);
        }
    });
});
