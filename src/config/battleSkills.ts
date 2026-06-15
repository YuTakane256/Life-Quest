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
