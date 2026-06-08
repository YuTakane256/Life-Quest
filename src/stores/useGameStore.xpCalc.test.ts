import { describe, expect, it } from 'vitest';
import { calculateLevel, calculateNextLevelXp, calculateXpProgress } from './useGameStore';
import { XP_CONFIG } from '../config/gameConfig';

describe('useGameStore XP pure calculations', () => {
    describe('calculateLevel', () => {
        it('returns 1 for 0 XP', () => {
            expect(calculateLevel(0)).toBe(1);
        });

        it('returns correct level within the table bounds', () => {
            const table = XP_CONFIG.LEVEL_XP_TABLE;
            // table[1] is Lv1 threshold (0)
            // table[2] is Lv2 threshold
            expect(calculateLevel(table[2])).toBe(2);
            expect(calculateLevel(table[2] - 1)).toBe(1);
            expect(calculateLevel(table[3])).toBe(3);
        });

        it('returns correct level for overflow XP (beyond table)', () => {
            const table = XP_CONFIG.LEVEL_XP_TABLE;
            const maxTableLevel = table.length - 1;
            const maxTableXp = table[maxTableLevel];
            
            expect(calculateLevel(maxTableXp)).toBe(maxTableLevel);
            expect(calculateLevel(maxTableXp + XP_CONFIG.OVERFLOW_XP_PER_LEVEL - 1)).toBe(maxTableLevel);
            expect(calculateLevel(maxTableXp + XP_CONFIG.OVERFLOW_XP_PER_LEVEL)).toBe(maxTableLevel + 1);
            expect(calculateLevel(maxTableXp + XP_CONFIG.OVERFLOW_XP_PER_LEVEL * 2)).toBe(maxTableLevel + 2);
        });

        it('handles negative XP gracefully by returning 1', () => {
            expect(calculateLevel(-100)).toBe(1);
        });
    });

    describe('calculateNextLevelXp', () => {
        it('returns next level XP threshold within the table bounds', () => {
            const table = XP_CONFIG.LEVEL_XP_TABLE;
            expect(calculateNextLevelXp(1)).toBe(table[2]);
            expect(calculateNextLevelXp(2)).toBe(table[3]);
        });

        it('returns next level XP threshold for overflow levels', () => {
            const table = XP_CONFIG.LEVEL_XP_TABLE;
            const maxTableLevel = table.length - 1;
            const maxTableXp = table[maxTableLevel];
            
            expect(calculateNextLevelXp(maxTableLevel)).toBe(maxTableXp + XP_CONFIG.OVERFLOW_XP_PER_LEVEL);
            expect(calculateNextLevelXp(maxTableLevel + 1)).toBe(maxTableXp + XP_CONFIG.OVERFLOW_XP_PER_LEVEL * 2);
        });
    });

    describe('calculateXpProgress', () => {
        it('returns 0 when totalXp exactly matches current level threshold', () => {
            const table = XP_CONFIG.LEVEL_XP_TABLE;
            expect(calculateXpProgress(table[1], 1)).toBe(0);
            expect(calculateXpProgress(table[2], 2)).toBe(0);
        });

        it('returns correct progress fraction within the table bounds', () => {
            const table = XP_CONFIG.LEVEL_XP_TABLE;
            const currentLevelXp = table[1];
            const nextLevelXp = table[2];
            const midPoint = currentLevelXp + (nextLevelXp - currentLevelXp) / 2;
            expect(calculateXpProgress(midPoint, 1)).toBe(0.5);
        });

        it('returns correct progress fraction for overflow levels', () => {
            const table = XP_CONFIG.LEVEL_XP_TABLE;
            const maxTableLevel = table.length - 1;
            const maxTableXp = table[maxTableLevel];
            
            const totalXp = maxTableXp + XP_CONFIG.OVERFLOW_XP_PER_LEVEL / 2;
            expect(calculateXpProgress(totalXp, maxTableLevel)).toBe(0.5);
            
            const totalXp2 = maxTableXp + XP_CONFIG.OVERFLOW_XP_PER_LEVEL * 1.5;
            expect(calculateXpProgress(totalXp2, maxTableLevel + 1)).toBe(0.5);
        });
    });
});
