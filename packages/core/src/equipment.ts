export const EQUIPMENT_SLOTS = ['weapon', 'armor', 'accessory'] as const;
export const EQUIPMENT_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

export type EquipmentSlot = typeof EQUIPMENT_SLOTS[number];
export type Rarity = typeof EQUIPMENT_RARITIES[number];

export interface EquipmentTemplate {
    id: string;
    name: string;
    slot: EquipmentSlot;
    rarity: Rarity;
    attackBonus: number;
    defenseBonus: number;
    hpBonus: number;
}

export interface Equipment {
    id: string;
    templateId: string;
    name: string;
    slot: EquipmentSlot;
    rarity: Rarity;
    attackBonus: number;
    defenseBonus: number;
    hpBonus: number;
    equipped: boolean;
}

export interface BaseCharacterStats {
    baseAttack: number;
    baseDefense: number;
    baseMaxHp: number;
}

export interface EffectiveStats {
    attack: number;
    defense: number;
    maxHp: number;
}

export interface SynthesisSelection {
    items: readonly Equipment[];
    nextRarity: Rarity;
    dominantSlots: readonly EquipmentSlot[];
}

export function createEquipmentFromTemplate(id: string, template: EquipmentTemplate): Equipment {
    return {
        id,
        templateId: template.id,
        name: template.name,
        slot: template.slot,
        rarity: template.rarity,
        attackBonus: template.attackBonus,
        defenseBonus: template.defenseBonus,
        hpBonus: template.hpBonus,
        equipped: false,
    };
}

export function calculateEffectiveEquipmentStats(
    character: BaseCharacterStats,
    equipment: readonly Equipment[],
): EffectiveStats {
    return equipment.reduce<EffectiveStats>((stats, item) => {
        if (!item.equipped) return stats;
        return {
            attack: stats.attack + item.attackBonus,
            defense: stats.defense + item.defenseBonus,
            maxHp: stats.maxHp + item.hpBonus,
        };
    }, {
        attack: character.baseAttack,
        defense: character.baseDefense,
        maxHp: character.baseMaxHp,
    });
}

export function getEquipmentScore(item: Equipment): number {
    return item.attackBonus + item.defenseBonus + item.hpBonus;
}

export function getBestEquipmentIdsBySlot(
    equipment: readonly Equipment[],
): Map<EquipmentSlot, string> {
    const result = new Map<EquipmentSlot, string>();

    for (const slot of EQUIPMENT_SLOTS) {
        let best: Equipment | undefined;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (const item of equipment) {
            if (item.slot !== slot) continue;
            const score = getEquipmentScore(item);
            if (score > bestScore) {
                best = item;
                bestScore = score;
            }
        }
        if (best) result.set(slot, best.id);
    }

    return result;
}

export function getDominantEquipmentSlots(items: readonly Equipment[]): EquipmentSlot[] {
    if (items.length === 0) return [];

    const counts: Record<EquipmentSlot, number> = { weapon: 0, armor: 0, accessory: 0 };
    for (const item of items) counts[item.slot] += 1;
    const maxCount = Math.max(...Object.values(counts));
    return EQUIPMENT_SLOTS.filter((slot) => counts[slot] === maxCount);
}

export function getNextEquipmentRarity(rarity: Rarity): Rarity | null {
    const rarityIndex = EQUIPMENT_RARITIES.indexOf(rarity);
    return rarityIndex >= 0 && rarityIndex < EQUIPMENT_RARITIES.length - 1
        ? EQUIPMENT_RARITIES[rarityIndex + 1]
        : null;
}

export function selectSynthesisIngredients(
    equipmentIds: readonly string[],
    inventory: readonly Equipment[],
    requiredCount: number,
): SynthesisSelection | null {
    if (!Number.isInteger(requiredCount) || requiredCount <= 0) return null;
    if (equipmentIds.length !== requiredCount) return null;
    if (new Set(equipmentIds).size !== requiredCount) return null;

    const itemById = new Map(inventory.map((item) => [item.id, item]));
    const items: Equipment[] = [];
    for (const id of equipmentIds) {
        const item = itemById.get(id);
        if (!item) return null;
        items.push(item);
    }

    const rarity = items[0].rarity;
    if (items.some((item) => item.rarity !== rarity || item.equipped)) return null;
    const nextRarity = getNextEquipmentRarity(rarity);
    if (!nextRarity) return null;

    return {
        items,
        nextRarity,
        dominantSlots: getDominantEquipmentSlots(items),
    };
}

export function getEquipmentSellXp(
    item: Pick<Equipment, 'rarity' | 'equipped'>,
    rewards: Readonly<Record<Rarity, number>>,
): number {
    if (item.equipped) return 0;
    const reward = rewards[item.rarity];
    return Number.isFinite(reward) && reward >= 0 ? Math.floor(reward) : 0;
}
