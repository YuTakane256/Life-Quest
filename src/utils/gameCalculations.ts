import { BATTLE_CONFIG, XP_CONFIG } from '../config/gameConfig';
import type { BattleState, CharacterStats, Equipment, EquipmentSlot } from '../types';
import { toBoundedInteger } from './persistSanitize';

export const MAX_TOTAL_XP = Number.MAX_SAFE_INTEGER;
export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ['weapon', 'armor', 'accessory'];

export interface EffectiveStats {
    attack: number;
    defense: number;
    maxHp: number;
}

export function calculateLevel(totalXp: number): number {
    const safeTotalXp = toBoundedInteger(totalXp, 0, 0, MAX_TOTAL_XP);
    const table = XP_CONFIG.LEVEL_XP_TABLE;
    const maxTableLevel = table.length - 1;
    if (safeTotalXp >= table[maxTableLevel]) {
        const remainingXp = safeTotalXp - table[maxTableLevel];
        return maxTableLevel + Math.floor(remainingXp / XP_CONFIG.OVERFLOW_XP_PER_LEVEL);
    }
    for (let i = maxTableLevel; i >= 0; i -= 1) {
        if (safeTotalXp >= table[i]) return i;
    }
    return 1;
}

export function calculateNextLevelXp(level: number): number {
    const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
    const table = XP_CONFIG.LEVEL_XP_TABLE;
    const maxTableLevel = table.length - 1;
    if (safeLevel >= maxTableLevel) {
        return table[maxTableLevel] + (safeLevel - maxTableLevel + 1) * XP_CONFIG.OVERFLOW_XP_PER_LEVEL;
    }
    return table[safeLevel + 1];
}

export function calculateXpProgress(totalXp: number, level: number): number {
    const safeTotalXp = toBoundedInteger(totalXp, 0, 0, MAX_TOTAL_XP);
    const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
    const table = XP_CONFIG.LEVEL_XP_TABLE;
    const maxTableLevel = table.length - 1;
    if (safeLevel >= maxTableLevel) {
        const baseXp = table[maxTableLevel] + (safeLevel - maxTableLevel) * XP_CONFIG.OVERFLOW_XP_PER_LEVEL;
        return Math.max(0, Math.min(1, (safeTotalXp - baseXp) / XP_CONFIG.OVERFLOW_XP_PER_LEVEL));
    }
    const currentLevelXp = table[safeLevel];
    const nextLevelXp = table[safeLevel + 1];
    return Math.max(0, Math.min(1, (safeTotalXp - currentLevelXp) / (nextLevelXp - currentLevelXp)));
}

export function calculateDamage(attack: number, defense: number): number {
    const damage = Math.floor(attack - defense * BATTLE_CONFIG.DEFENSE_FACTOR);
    return Math.max(damage, BATTLE_CONFIG.MIN_DAMAGE);
}

export function calculateEffectiveStats(
    character: CharacterStats,
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

export function getBestEquipmentIdsBySlot(equipment: readonly Equipment[]): Map<EquipmentSlot, string> {
    const result = new Map<EquipmentSlot, string>();

    for (const slot of EQUIPMENT_SLOTS) {
        let best: Equipment | undefined;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (const item of equipment) {
            if (item.slot !== slot) continue;
            const score = item.attackBonus + item.defenseBonus + item.hpBonus;
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
    const counts: Record<EquipmentSlot, number> = { weapon: 0, armor: 0, accessory: 0 };
    for (const item of items) counts[item.slot] += 1;
    const maxCount = Math.max(...Object.values(counts));
    return EQUIPMENT_SLOTS.filter((slot) => counts[slot] === maxCount);
}

export function tickSkillCooldowns(cooldowns: Readonly<Record<string, number>>): Record<string, number> {
    return Object.fromEntries(
        Object.entries(cooldowns)
            .map(([skillId, turns]) => [skillId, Math.max(0, turns - 1)] as const)
            .filter(([, turns]) => turns > 0)
    );
}

export function getGuardReduction(
    battle: Pick<BattleState, 'guardTurnsRemaining' | 'guardDamageReduction'>,
    maxDamageReduction: number,
): number {
    return battle.guardTurnsRemaining > 0
        ? Math.max(0, Math.min(maxDamageReduction, battle.guardDamageReduction))
        : 0;
}
