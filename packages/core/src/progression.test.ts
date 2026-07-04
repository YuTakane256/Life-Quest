import { describe, expect, it } from 'vitest';
import {
    applyCharacterXp,
    calculateLevel,
    calculateNextLevelXp,
    calculateXpProgress,
    CHARACTER_CONFIG,
    MAX_TOTAL_XP,
    XP_CONFIG,
    type CharacterProgressionState,
} from './progression.ts';

function character(overrides: Partial<CharacterProgressionState> = {}): CharacterProgressionState {
    return {
        level: CHARACTER_CONFIG.INITIAL_STATS.level,
        totalXp: CHARACTER_CONFIG.INITIAL_STATS.totalXp,
        baseAttack: CHARACTER_CONFIG.INITIAL_STATS.attack,
        baseDefense: CHARACTER_CONFIG.INITIAL_STATS.defense,
        baseMaxHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp,
        ...overrides,
    };
}

describe('character progression domain', () => {
    it('maps table and overflow thresholds to levels', () => {
        expect(calculateLevel(0)).toBe(1);
        expect(calculateLevel(29)).toBe(1);
        expect(calculateLevel(30)).toBe(2);
        expect(calculateLevel(80)).toBe(3);

        const table = XP_CONFIG.LEVEL_XP_TABLE;
        const maxLevel = table.length - 1;
        expect(calculateLevel(table[maxLevel] + XP_CONFIG.OVERFLOW_XP_PER_LEVEL)).toBe(maxLevel + 1);
    });

    it('normalizes malformed XP and level values', () => {
        expect(calculateLevel(-1)).toBe(1);
        expect(calculateLevel(Number.NaN)).toBe(1);
        expect(calculateNextLevelXp(Number.POSITIVE_INFINITY)).toBe(XP_CONFIG.LEVEL_XP_TABLE[2]);
        expect(calculateXpProgress(Number.NaN, Number.NaN)).toBe(0);
    });

    it('calculates next thresholds and bounded progress', () => {
        expect(calculateNextLevelXp(1)).toBe(30);
        expect(calculateNextLevelXp(2)).toBe(80);
        expect(calculateXpProgress(15, 1)).toBe(0.5);
        expect(calculateXpProgress(999_999, 1)).toBe(1);
    });

    it('applies XP and all stat gains across multiple levels', () => {
        const result = applyCharacterXp(character(), 80);

        expect(result.character).toEqual({
            level: 3,
            totalXp: 80,
            baseAttack: 9,
            baseDefense: 5,
            baseMaxHp: 70,
        });
        expect(result.levelGain).toBe(2);
        expect(result.statGains).toEqual({ attack: 4, defense: 2, maxHp: 20 });
    });

    it('applies reward multipliers after normalizing the base reward', () => {
        const result = applyCharacterXp(character(), 50.9, XP_CONFIG.DEBUFF_XP_MULTIPLIER);
        expect(result.appliedXp).toBe(40);
        expect(result.character.totalXp).toBe(40);
    });

    it('ignores invalid rewards and saturates at the safe integer limit', () => {
        expect(applyCharacterXp(character(), Number.POSITIVE_INFINITY).appliedXp).toBe(0);
        expect(applyCharacterXp(character(), -10).appliedXp).toBe(0);

        const result = applyCharacterXp(character({
            totalXp: MAX_TOTAL_XP - 5,
            level: calculateLevel(MAX_TOTAL_XP - 5),
        }), 100);
        expect(result.character.totalXp).toBe(MAX_TOTAL_XP);
        expect(result.appliedXp).toBe(5);
    });
});
