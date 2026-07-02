import { describe, expect, it } from 'vitest';
import {
    calculateEffectiveEquipmentStats,
    createEquipmentFromTemplate,
    getBestEquipmentIdsBySlot,
    getDominantEquipmentSlots,
    getEquipmentSellXp,
    getNextEquipmentRarity,
    selectSynthesisIngredients,
    type Equipment,
    type EquipmentSlot,
    type EquipmentTemplate,
} from './equipment';

function equipment(id: string, slot: EquipmentSlot, overrides: Partial<Equipment> = {}): Equipment {
    return {
        id,
        templateId: id,
        name: id,
        slot,
        rarity: 'common',
        attackBonus: 0,
        defenseBonus: 0,
        hpBonus: 0,
        equipped: false,
        ...overrides,
    };
}

describe('equipment domain', () => {
    it('creates a fresh unequipped item without mutating its template', () => {
        const template: EquipmentTemplate = {
            id: 'iron_sword',
            name: '鉄の剣',
            slot: 'weapon',
            rarity: 'uncommon',
            attackBonus: 5,
            defenseBonus: 0,
            hpBonus: 0,
        };

        expect(createEquipmentFromTemplate('instance-1', template)).toEqual({
            ...template,
            id: 'instance-1',
            templateId: 'iron_sword',
            equipped: false,
        });
        expect(template.id).toBe('iron_sword');
    });

    it('adds bonuses from equipped items only', () => {
        const items = [
            equipment('weapon', 'weapon', { attackBonus: 4, equipped: true }),
            equipment('armor', 'armor', { defenseBonus: 3, hpBonus: 20, equipped: true }),
            equipment('spare', 'weapon', { attackBonus: 99 }),
        ];

        expect(calculateEffectiveEquipmentStats(
            { baseAttack: 10, baseDefense: 8, baseMaxHp: 100 },
            items,
        )).toEqual({ attack: 14, defense: 11, maxHp: 120 });
    });

    it('selects the first highest-scoring item in each slot', () => {
        const best = getBestEquipmentIdsBySlot([
            equipment('first', 'weapon', { attackBonus: 5 }),
            equipment('tied', 'weapon', { defenseBonus: 5 }),
            equipment('armor', 'armor', { defenseBonus: 4 }),
        ]);

        expect(Object.fromEntries(best)).toEqual({ weapon: 'first', armor: 'armor' });
    });

    it('returns all tied dominant slots and no slots for an empty selection', () => {
        expect(getDominantEquipmentSlots([])).toEqual([]);
        expect(getDominantEquipmentSlots([
            equipment('w', 'weapon'),
            equipment('a', 'armor'),
            equipment('r', 'accessory'),
        ])).toEqual(['weapon', 'armor', 'accessory']);
    });

    it('moves through rarity order and stops at legendary', () => {
        expect(getNextEquipmentRarity('common')).toBe('uncommon');
        expect(getNextEquipmentRarity('epic')).toBe('legendary');
        expect(getNextEquipmentRarity('legendary')).toBeNull();
    });

    it('validates synthesis ingredients and preserves dominant slots', () => {
        const inventory = [
            equipment('w', 'weapon'),
            equipment('a1', 'armor'),
            equipment('a2', 'armor'),
        ];

        expect(selectSynthesisIngredients(['w', 'a1', 'a2'], inventory, 3)).toMatchObject({
            nextRarity: 'uncommon',
            dominantSlots: ['armor'],
        });
        expect(selectSynthesisIngredients(['w', 'w', 'a1'], inventory, 3)).toBeNull();
        expect(selectSynthesisIngredients(['w', 'a1', 'missing'], inventory, 3)).toBeNull();
        expect(selectSynthesisIngredients(['w', 'a1'], inventory, 3)).toBeNull();
    });

    it('rejects equipped, mixed-rarity, and legendary synthesis ingredients', () => {
        expect(selectSynthesisIngredients([
            'w', 'a', 'r',
        ], [
            equipment('w', 'weapon', { equipped: true }),
            equipment('a', 'armor'),
            equipment('r', 'accessory'),
        ], 3)).toBeNull();

        expect(selectSynthesisIngredients([
            'w', 'a', 'r',
        ], [
            equipment('w', 'weapon'),
            equipment('a', 'armor', { rarity: 'rare' }),
            equipment('r', 'accessory'),
        ], 3)).toBeNull();

        const legendary = ['w', 'a', 'r'].map((id, index) =>
            equipment(id, ['weapon', 'armor', 'accessory'][index] as EquipmentSlot, { rarity: 'legendary' })
        );
        expect(selectSynthesisIngredients(['w', 'a', 'r'], legendary, 3)).toBeNull();
    });

    it('normalizes sell rewards and blocks equipped items', () => {
        const rewards = { common: 5, uncommon: 20, rare: 70, epic: 240, legendary: 800 };
        expect(getEquipmentSellXp(equipment('w', 'weapon'), rewards)).toBe(5);
        expect(getEquipmentSellXp(equipment('w', 'weapon', { equipped: true }), rewards)).toBe(0);
        expect(getEquipmentSellXp(equipment('w', 'weapon'), { ...rewards, common: 5.9 })).toBe(5);
    });
});
