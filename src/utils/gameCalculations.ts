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

// ダメージ計算・クールダウン・ガード軽減は @life-quest/core/battle に移動（#509）。
export { calculateDamage, getGuardReduction, tickSkillCooldowns } from '@life-quest/core/battle';
