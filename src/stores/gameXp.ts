/**
 * XP・レベル・ダメージ計算。useGameStore から分離した純粋関数群。
 * 永続化データや外部入力が混入しても破綻しないよう、入力は内部で正規化する。
 */
import { XP_CONFIG, BATTLE_CONFIG } from '../config/gameConfig';
import { toNonNegativeInteger } from '../utils/persistSanitize';

export function calculateLevel(totalXp: number): number {
    const safeTotalXp = toNonNegativeInteger(totalXp, 0);
    const table = XP_CONFIG.LEVEL_XP_TABLE;
    const maxTableLevel = table.length - 1;
    if (safeTotalXp >= table[maxTableLevel]) {
        const remainingXp = safeTotalXp - table[maxTableLevel];
        return maxTableLevel + Math.floor(remainingXp / XP_CONFIG.OVERFLOW_XP_PER_LEVEL);
    }
    for (let i = maxTableLevel; i >= 0; i--) {
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
    const safeTotalXp = toNonNegativeInteger(totalXp, 0);
    const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
    const table = XP_CONFIG.LEVEL_XP_TABLE;
    const maxTableLevel = table.length - 1;
    if (safeLevel >= maxTableLevel) {
        const baseXp = table[maxTableLevel] + (safeLevel - maxTableLevel) * XP_CONFIG.OVERFLOW_XP_PER_LEVEL;
        const nextXp = baseXp + XP_CONFIG.OVERFLOW_XP_PER_LEVEL;
        return Math.max(0, Math.min(1, (safeTotalXp - baseXp) / (nextXp - baseXp)));
    }
    const currentLevelXp = table[safeLevel];
    const nextLevelXp = table[safeLevel + 1];
    return Math.max(0, Math.min(1, (safeTotalXp - currentLevelXp) / (nextLevelXp - currentLevelXp)));
}

export function calculateDamage(attack: number, defense: number): number {
    const damage = Math.floor(attack - defense * BATTLE_CONFIG.DEFENSE_FACTOR);
    return Math.max(damage, BATTLE_CONFIG.MIN_DAMAGE);
}
