import { clamp, nonNegativeInteger, nonNegativeRatio } from './numeric.ts';

export type BattleSkillType = 'damage' | 'heal' | 'guard';

export interface BattleSkillDefinition {
    id: string;
    name: string;
    description: string;
    type: BattleSkillType;
    unlockLevel: number;
    power: number;
    cooldownTurns: number;
    durationTurns?: number;
}

export const BATTLE_SKILL_CONFIG = {
    MAX_DAMAGE_REDUCTION: 0.9,
} as const;

export const BATTLE_SKILLS = [
    {
        id: 'power_strike',
        name: '強撃',
        description: '通常攻撃より大きなダメージを与える。',
        type: 'damage',
        unlockLevel: 1,
        power: 1.6,
        cooldownTurns: 2,
    },
    {
        id: 'first_aid',
        name: '応急手当',
        description: '最大HPに応じてHPを回復する。',
        type: 'heal',
        unlockLevel: 3,
        power: 0.25,
        cooldownTurns: 4,
    },
    {
        id: 'guard_stance',
        name: '防御態勢',
        description: '一定ターン、受けるダメージを軽減する。',
        type: 'guard',
        unlockLevel: 5,
        power: 0.5,
        cooldownTurns: 3,
        durationTurns: 2,
    },
] satisfies readonly BattleSkillDefinition[];

export interface BattleSkillContext {
    attack: number;
    currentHp: number;
    maxHp: number;
}

export type BattleSkillResolution =
    | { type: 'damage'; skill: BattleSkillDefinition; damage: number }
    | { type: 'heal'; skill: BattleSkillDefinition; heal: number }
    | { type: 'guard'; skill: BattleSkillDefinition; damageReduction: number; durationTurns: number };

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
