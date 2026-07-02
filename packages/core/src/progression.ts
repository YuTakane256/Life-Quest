export const MAX_TOTAL_XP = Number.MAX_SAFE_INTEGER;

export const XP_CONFIG = {
    REWARD_BY_PRIORITY: {
        low: 10,
        medium: 20,
        high: 30,
    },
    SUBTASK_REWARD_RATIO: 0.5,
    HABIT_ALL_COMPLETE_BONUS: 15,
    DEBUFF_XP_MULTIPLIER: 0.8,
    DEBUFF_DURATION_MS: 24 * 60 * 60 * 1000,
    LEVEL_XP_TABLE: [
        0,
        0,
        30,
        80,
        150,
        250,
        400,
        600,
        850,
        1150,
        1500,
        2000,
        2600,
        3300,
        4100,
        5000,
        6000,
        7200,
        8600,
        10200,
        12000,
    ] as readonly number[],
    OVERFLOW_XP_PER_LEVEL: 2000,
} as const;

export const CHARACTER_CONFIG = {
    INITIAL_STATS: {
        name: 'あなた',
        avatar: 'female',
        level: 1,
        totalXp: 0,
        attack: 5,
        defense: 3,
        maxHp: 50,
    },
    STAT_PER_LEVEL: {
        attack: 2,
        defense: 1,
        maxHp: 10,
    },
} as const;

export interface CharacterProgressionState {
    level: number;
    totalXp: number;
    baseAttack: number;
    baseDefense: number;
    baseMaxHp: number;
}

export interface CharacterStatGains {
    attack: number;
    defense: number;
    maxHp: number;
}

export interface ApplyCharacterXpResult {
    character: CharacterProgressionState;
    appliedXp: number;
    levelGain: number;
    statGains: CharacterStatGains;
}

function boundedInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.floor(value)));
}

function safeLevel(level: number): number {
    return Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
}

export function calculateLevel(totalXp: number): number {
    const safeTotalXp = boundedInteger(totalXp, 0, MAX_TOTAL_XP);
    const table = XP_CONFIG.LEVEL_XP_TABLE;
    const maxTableLevel = table.length - 1;

    if (safeTotalXp >= table[maxTableLevel]) {
        const remainingXp = safeTotalXp - table[maxTableLevel];
        return maxTableLevel + Math.floor(remainingXp / XP_CONFIG.OVERFLOW_XP_PER_LEVEL);
    }

    for (let level = maxTableLevel; level >= 1; level -= 1) {
        if (safeTotalXp >= table[level]) return level;
    }
    return 1;
}

export function calculateNextLevelXp(level: number): number {
    const normalizedLevel = safeLevel(level);
    const table = XP_CONFIG.LEVEL_XP_TABLE;
    const maxTableLevel = table.length - 1;

    if (normalizedLevel >= maxTableLevel) {
        return table[maxTableLevel]
            + (normalizedLevel - maxTableLevel + 1) * XP_CONFIG.OVERFLOW_XP_PER_LEVEL;
    }
    return table[normalizedLevel + 1];
}

export function calculateXpProgress(totalXp: number, level: number): number {
    const safeTotalXp = boundedInteger(totalXp, 0, MAX_TOTAL_XP);
    const normalizedLevel = safeLevel(level);
    const table = XP_CONFIG.LEVEL_XP_TABLE;
    const maxTableLevel = table.length - 1;

    if (normalizedLevel >= maxTableLevel) {
        const baseXp = table[maxTableLevel]
            + (normalizedLevel - maxTableLevel) * XP_CONFIG.OVERFLOW_XP_PER_LEVEL;
        return Math.max(0, Math.min(
            1,
            (safeTotalXp - baseXp) / XP_CONFIG.OVERFLOW_XP_PER_LEVEL,
        ));
    }

    const currentLevelXp = table[normalizedLevel];
    const nextLevelXp = table[normalizedLevel + 1];
    return Math.max(0, Math.min(
        1,
        (safeTotalXp - currentLevelXp) / (nextLevelXp - currentLevelXp),
    ));
}

export function applyCharacterXp(
    character: CharacterProgressionState,
    baseXp: number,
    multiplier = 1,
): ApplyCharacterXpResult {
    const safeBaseXp = boundedInteger(baseXp, 0, MAX_TOTAL_XP);
    const safeMultiplier = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 0;
    const currentTotalXp = boundedInteger(character.totalXp, 0, MAX_TOTAL_XP);
    const actualXp = Math.floor(safeBaseXp * safeMultiplier);
    const newTotalXp = Math.min(MAX_TOTAL_XP, currentTotalXp + actualXp);
    const appliedXp = newTotalXp - currentTotalXp;
    const newLevel = calculateLevel(newTotalXp);
    const currentLevel = safeLevel(character.level);
    const levelGain = Math.max(0, newLevel - currentLevel);
    const statGains = {
        attack: levelGain * CHARACTER_CONFIG.STAT_PER_LEVEL.attack,
        defense: levelGain * CHARACTER_CONFIG.STAT_PER_LEVEL.defense,
        maxHp: levelGain * CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp,
    };

    return {
        character: {
            ...character,
            totalXp: newTotalXp,
            level: newLevel,
            baseAttack: character.baseAttack + statGains.attack,
            baseDefense: character.baseDefense + statGains.defense,
            baseMaxHp: character.baseMaxHp + statGains.maxHp,
        },
        appliedXp,
        levelGain,
        statGains,
    };
}
