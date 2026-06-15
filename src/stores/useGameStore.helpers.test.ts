import { describe, expect, it } from 'vitest';
import { createEquipmentInstance, calculateDamage } from './useGameStore';
import { BATTLE_CONFIG } from '../config/gameConfig';
import type { EquipmentTemplate } from '../types';

describe('useGameStore helpers', () => {
    describe('createEquipmentInstance', () => {
        const template: EquipmentTemplate = {
            id: 'iron_sword',
            name: '鉄の剣',
            slot: 'weapon',
            rarity: 'common',
            attackBonus: 10,
            defenseBonus: 0,
            hpBonus: 0
        };

        it('should create an Equipment instance from a template', () => {
            const instance = createEquipmentInstance(template);

            expect(instance).toBeDefined();
            // It should generate a unique id
            expect(instance.id).not.toBe(template.id);
            expect(typeof instance.id).toBe('string');
            expect(instance.id.length).toBeGreaterThan(0);

            // Other properties should be copied
            expect(instance.name).toBe(template.name);
            expect(instance.slot).toBe(template.slot);
            expect(instance.rarity).toBe(template.rarity);
            expect(instance.attackBonus).toBe(template.attackBonus);
            expect(instance.defenseBonus).toBe(template.defenseBonus);
            expect(instance.hpBonus).toBe(template.hpBonus);

            // It should be unequipped by default
            expect(instance.equipped).toBe(false);
        });

        it('should preserve slot, rarity, and all stat bonuses for armor/accessory templates', () => {
            const armorTemplate: EquipmentTemplate = {
                id: 'dragon_armor',
                name: 'ドラゴンアーマー',
                slot: 'armor',
                rarity: 'epic',
                attackBonus: 3,
                defenseBonus: 18,
                hpBonus: 35,
            };
            const accessoryTemplate: EquipmentTemplate = {
                id: 'ring_of_god',
                name: '神の指輪',
                slot: 'accessory',
                rarity: 'legendary',
                attackBonus: 15,
                defenseBonus: 15,
                hpBonus: 40,
            };

            expect(createEquipmentInstance(armorTemplate)).toMatchObject({
                templateId: armorTemplate.id,
                slot: 'armor',
                rarity: 'epic',
                attackBonus: 3,
                defenseBonus: 18,
                hpBonus: 35,
                equipped: false,
            });
            expect(createEquipmentInstance(accessoryTemplate)).toMatchObject({
                templateId: accessoryTemplate.id,
                slot: 'accessory',
                rarity: 'legendary',
                attackBonus: 15,
                defenseBonus: 15,
                hpBonus: 40,
                equipped: false,
            });
        });

        it('should generate unique IDs for multiple instances of the same template', () => {
            const instance1 = createEquipmentInstance(template);
            const instance2 = createEquipmentInstance(template);
            expect(instance1.id).not.toBe(instance2.id);
        });
    });

    describe('calculateDamage', () => {
        it('should calculate damage as attack - defense * DEFENSE_FACTOR', () => {
            const attack = 100;
            const defense = 20;
            const expectedDamage = Math.floor(attack - defense * BATTLE_CONFIG.DEFENSE_FACTOR);
            // Assuming BATTLE_CONFIG.DEFENSE_FACTOR is 0.5 => 100 - 10 = 90
            expect(calculateDamage(attack, defense)).toBe(expectedDamage);
        });

        it('should floor fractional damage before applying the minimum', () => {
            expect(calculateDamage(11, 5)).toBe(Math.floor(11 - 5 * BATTLE_CONFIG.DEFENSE_FACTOR));
        });

        it('should return raw attack damage when defense is zero and attack exceeds the minimum', () => {
            expect(calculateDamage(12, 0)).toBe(12);
        });

        it('should preserve exact MIN_DAMAGE when the formula lands on the minimum', () => {
            expect(calculateDamage(BATTLE_CONFIG.MIN_DAMAGE + BATTLE_CONFIG.DEFENSE_FACTOR * 2, 2)).toBe(BATTLE_CONFIG.MIN_DAMAGE);
        });

        it('should enforce MIN_DAMAGE when defense is very high', () => {
            const attack = 10;
            const defense = 1000;
            expect(calculateDamage(attack, defense)).toBe(BATTLE_CONFIG.MIN_DAMAGE);
        });

        it('should enforce MIN_DAMAGE when attack is 0', () => {
            const attack = 0;
            const defense = 0;
            expect(calculateDamage(attack, defense)).toBe(BATTLE_CONFIG.MIN_DAMAGE);
        });
    });
});
