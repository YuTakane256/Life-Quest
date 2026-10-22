import { EQUIPMENT_RARITIES, getNextEquipmentRarity, type Equipment, type EquipmentSlot, type Rarity } from './equipment.ts';

export type InventorySortMode = 'rarity' | 'slot' | 'name';
export type InventorySlotFilter = 'all' | EquipmentSlot;
export type InventoryRarityFilter = 'all' | Rarity;

export const INVENTORY_SELECTION_CHANGED = '装備が変更されたため、該当する素材の選択を解除しました。';

function sameItem(approved: Equipment, current: Equipment): boolean {
    return (Object.keys(approved) as (keyof Equipment)[]).every((key) => current[key] === approved[key]);
}

/** Selection approves item values, not just IDs that a later pull may reuse. */
export function reconcileSynthesisSelection(selected: readonly Equipment[], inventory: readonly Equipment[]): readonly Equipment[] {
    const current = new Map(inventory.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const valid = selected.filter((item) => {
        const latest = current.get(item.id);
        if (seen.has(item.id) || !latest || latest.equipped || !getNextEquipmentRarity(latest.rarity) || !sameItem(item, latest)) return false;
        seen.add(item.id); return true;
    });
    return valid.length === selected.length ? selected : valid;
}

export function toggleSynthesisSelection(
    selected: readonly Equipment[], item: Equipment, inventory: readonly Equipment[], requiredCount: number,
): readonly Equipment[] {
    const valid = reconcileSynthesisSelection(selected, inventory);
    const latest = inventory.find((candidate) => candidate.id === item.id);
    if (!latest || latest.equipped || !sameItem(item, latest) || !getNextEquipmentRarity(item.rarity)) return valid;
    if (valid.some((candidate) => candidate.id === item.id)) return valid.filter((candidate) => candidate.id !== item.id);
    if (!Number.isInteger(requiredCount) || requiredCount < 1 || valid.length >= requiredCount || (valid.length && valid[0].rarity !== item.rarity)) return valid;
    return [...valid, { ...item }];
}

/** A confirmation approves these item values, not whatever later reuses their IDs. */
export function createInventoryConfirmation(
    items: readonly Equipment[],
    getInventory: () => readonly Equipment[],
    isCurrent: () => boolean,
    onConfirm: () => void,
): () => void {
    const approved = items.map((item) => ({ ...item }));
    let used = false;
    return () => {
        if (used) return;
        used = true;
        if (!isCurrent() || approved.length === 0 || new Set(approved.map((item) => item.id)).size !== approved.length) return;
        const inventory = getInventory();
        if (!approved.every((item) => {
            const current = inventory.find((candidate) => candidate.id === item.id);
            return current && !current.equipped && sameItem(item, current);
        })) return;
        onConfirm();
    };
}

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
