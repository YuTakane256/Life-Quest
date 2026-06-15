import {
    BATTLE_SKILL_CONFIG,
    BATTLE_SKILLS,
    type BattleSkillDefinition,
} from '../config/battleSkills';

export interface BattleSkillContext {
    attack: number;
    currentHp: number;
    maxHp: number;
}

export type BattleSkillResolution =
    | { type: 'damage'; skill: BattleSkillDefinition; damage: number }
    | { type: 'heal'; skill: BattleSkillDefinition; heal: number }
    | { type: 'guard'; skill: BattleSkillDefinition; damageReduction: number; durationTurns: number };

function nonNegativeInteger(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function nonNegativeRatio(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function getUnlockedBattleSkills(
    level: number,
    catalog: readonly BattleSkillDefinition[] = BATTLE_SKILLS,
): BattleSkillDefinition[] {
    const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
    return catalog.filter((skill) => skill.unlockLevel <= safeLevel);
}

export function findBattleSkill(
    skillId: string,
    catalog: readonly BattleSkillDefinition[] = BATTLE_SKILLS,
): BattleSkillDefinition | undefined {
    return catalog.find((skill) => skill.id === skillId);
}

export function resolveBattleSkill(
    skillId: string,
    context: BattleSkillContext,
    catalog: readonly BattleSkillDefinition[] = BATTLE_SKILLS,
): BattleSkillResolution | null {
    const skill = findBattleSkill(skillId, catalog);
    if (!skill) return null;

    if (skill.type === 'damage') {
        const damage = Math.max(1, Math.floor(nonNegativeInteger(context.attack) * nonNegativeRatio(skill.power)));
        return { type: 'damage', skill, damage };
    }

    if (skill.type === 'heal') {
        const maxHp = nonNegativeInteger(context.maxHp);
        const currentHp = clamp(nonNegativeInteger(context.currentHp), 0, maxHp);
        const missingHp = maxHp - currentHp;
        const heal = Math.min(missingHp, Math.ceil(maxHp * nonNegativeRatio(skill.power)));
        return { type: 'heal', skill, heal };
    }

    const damageReduction = clamp(
        nonNegativeRatio(skill.power),
        0,
        BATTLE_SKILL_CONFIG.MAX_DAMAGE_REDUCTION,
    );
    return {
        type: 'guard',
        skill,
        damageReduction,
        durationTurns: Math.max(1, nonNegativeInteger(skill.durationTurns ?? 1)),
    };
}
