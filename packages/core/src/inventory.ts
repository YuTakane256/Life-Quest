import { EQUIPMENT_RARITIES, type Equipment, type EquipmentSlot, type Rarity } from './equipment.ts';

export type InventorySortMode = 'rarity' | 'slot' | 'name';
export type InventorySlotFilter = 'all' | EquipmentSlot;
export type InventoryRarityFilter = 'all' | Rarity;

const RARITY_RANK: Record<Rarity, number> = Object.fromEntries(
    EQUIPMENT_RARITIES.map((rarity, index) => [rarity, index])
) as Record<Rarity, number>;

export interface FilterAndSortInventoryOptions {
    slotFilter: InventorySlotFilter;
    rarityFilter: InventoryRarityFilter;
    sortMode: InventorySortMode;
    slotLabels: Record<EquipmentSlot, string>;
}

export function filterAndSortInventory(
    items: readonly Equipment[],
    options: FilterAndSortInventoryOptions
): Equipment[] {
    const { slotFilter, rarityFilter, sortMode, slotLabels } = options;

    return items
        .filter((item) => slotFilter === 'all' || item.slot === slotFilter)
        .filter((item) => rarityFilter === 'all' || item.rarity === rarityFilter)
        .sort((a, b) => {
            if (sortMode === 'rarity') {
                return RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || a.name.localeCompare(b.name, 'ja');
            }
            if (sortMode === 'slot') {
                return slotLabels[a.slot].localeCompare(slotLabels[b.slot], 'ja') || a.name.localeCompare(b.name, 'ja');
            }
            return a.name.localeCompare(b.name, 'ja');
        });
}
