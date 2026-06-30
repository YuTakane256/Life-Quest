import { describe, expect, it } from 'vitest';
import type { CharacterStats, Equipment } from '../types';
import {
    calculateEffectiveStats,
    getBestEquipmentIdsBySlot,
    getDominantEquipmentSlots,
    getGuardReduction,
    tickSkillCooldowns,
} from './gameCalculations';

const character: CharacterStats = {
    name: 'Tester',
    avatar: 'female',
    level: 1,
    totalXp: 0,
    baseAttack: 10,
    baseDefense: 8,
    baseMaxHp: 100,
};

function equipment(overrides: Partial<Equipment> & Pick<Equipment, 'id' | 'slot'>): Equipment {
    return {
        templateId: overrides.id,
        name: overrides.id,
        rarity: 'common',
        attackBonus: 0,
        defenseBonus: 0,
        hpBonus: 0,
        equipped: false,
        ...overrides,
    };
}

describe('gameCalculations', () => {
    it('adds bonuses from equipped items only', () => {
        const items = [
            equipment({ id: 'weapon', slot: 'weapon', attackBonus: 4, equipped: true }),
            equipment({ id: 'armor', slot: 'armor', defenseBonus: 3, hpBonus: 20, equipped: true }),
            equipment({ id: 'spare', slot: 'weapon', attackBonus: 99 }),
        ];

        expect(calculateEffectiveStats(character, items)).toEqual({ attack: 14, defense: 11, maxHp: 120 });
    });

    it('selects the highest total bonus in each equipment slot', () => {
        const best = getBestEquipmentIdsBySlot([
            equipment({ id: 'weak', slot: 'weapon', attackBonus: 2 }),
            equipment({ id: 'strong', slot: 'weapon', attackBonus: 5 }),
            equipment({ id: 'armor', slot: 'armor', defenseBonus: 4 }),
        ]);

        expect(Object.fromEntries(best)).toEqual({ weapon: 'strong', armor: 'armor' });
    });

    it('keeps the first item when equipment scores tie', () => {
        const best = getBestEquipmentIdsBySlot([
            equipment({ id: 'first', slot: 'weapon', attackBonus: 5 }),
            equipment({ id: 'second', slot: 'weapon', defenseBonus: 5 }),
        ]);

        expect(best.get('weapon')).toBe('first');
    });

    it('returns every tied dominant slot for synthesis randomization', () => {
        expect(getDominantEquipmentSlots([
            equipment({ id: 'w', slot: 'weapon' }),
            equipment({ id: 'a', slot: 'armor' }),
            equipment({ id: 'r', slot: 'accessory' }),
        ])).toEqual(['weapon', 'armor', 'accessory']);

        expect(getDominantEquipmentSlots([
            equipment({ id: 'w1', slot: 'weapon' }),
            equipment({ id: 'w2', slot: 'weapon' }),
            equipment({ id: 'a', slot: 'armor' }),
        ])).toEqual(['weapon']);
    });

    it('ticks cooldowns and removes expired entries without mutating input', () => {
        const cooldowns = { slash: 2, heal: 1 };
        expect(tickSkillCooldowns(cooldowns)).toEqual({ slash: 1 });
        expect(cooldowns).toEqual({ slash: 2, heal: 1 });
    });

    it('clamps guard reduction and disables it when no guard turn remains', () => {
        expect(getGuardReduction({ guardTurnsRemaining: 1, guardDamageReduction: 0.9 }, 0.5)).toBe(0.5);
        expect(getGuardReduction({ guardTurnsRemaining: 0, guardDamageReduction: 0.4 }, 0.5)).toBe(0);
    });
});
