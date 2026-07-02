import { BATTLE_CONFIG } from '../config/gameConfig';
import type { BattleState } from '../types';

export {
    calculateEffectiveEquipmentStats as calculateEffectiveStats,
    EQUIPMENT_SLOTS,
    getBestEquipmentIdsBySlot,
    getDominantEquipmentSlots,
    type EffectiveStats,
} from '@life-quest/core/equipment';

export {
    calculateLevel,
    calculateNextLevelXp,
    calculateXpProgress,
    MAX_TOTAL_XP,
} from '@life-quest/core/progression';

export function calculateDamage(attack: number, defense: number): number {
    const damage = Math.floor(attack - defense * BATTLE_CONFIG.DEFENSE_FACTOR);
    return Math.max(damage, BATTLE_CONFIG.MIN_DAMAGE);
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
