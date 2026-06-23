import { describe, expect, it } from 'vitest';
import {
    BATTLE_CONFIG,
    EQUIPMENT_POOL,
    GACHA_CONFIG,
    MAP_CONFIG,
    RARITY_ORDER,
    SELL_XP_BY_RARITY,
    SYNTHESIS_CONFIG,
    XP_CONFIG,
    type ChestType,
    type EquipmentSlot,
} from './gameConfig';
import { CHEST_FALLBACK_IMAGE, CHEST_IMAGES, ITEM_IMAGES } from './equipmentAssets';

const EQUIPMENT_SLOTS: EquipmentSlot[] = ['weapon', 'armor', 'accessory'];

describe('gameConfig integrity', () => {
    it('keeps XP progression and rewards positive and monotonic', () => {
        expect(XP_CONFIG.LEVEL_XP_TABLE[1]).toBe(0);
        for (let i = 2; i < XP_CONFIG.LEVEL_XP_TABLE.length; i++) {
            expect(XP_CONFIG.LEVEL_XP_TABLE[i]).toBeGreaterThan(XP_CONFIG.LEVEL_XP_TABLE[i - 1]);
        }

        expect(Object.values(XP_CONFIG.REWARD_BY_PRIORITY).every((xp) => xp > 0)).toBe(true);
        expect(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS).toBeGreaterThan(0);
        expect(XP_CONFIG.SUBTASK_REWARD_RATIO).toBeGreaterThan(0);
        expect(XP_CONFIG.SUBTASK_REWARD_RATIO).toBeLessThanOrEqual(1);
        expect(XP_CONFIG.DEBUFF_XP_MULTIPLIER).toBeGreaterThan(0);
        expect(XP_CONFIG.DEBUFF_XP_MULTIPLIER).toBeLessThanOrEqual(1);
        expect(XP_CONFIG.OVERFLOW_XP_PER_LEVEL).toBeGreaterThan(0);
    });

    it('keeps every chest drop-rate table normalized to 100%', () => {
        for (const [chestType, rates] of Object.entries(GACHA_CONFIG.DROP_RATES)) {
            const total = (Object.values(rates) as number[]).reduce((sum, rate) => sum + rate, 0);
            expect(total, `${chestType} rates`).toBeCloseTo(1, 5);
        }
    });

    it('keeps gacha milestones inside the configured cycle', () => {
        for (const milestone of GACHA_CONFIG.MILESTONES) {
            expect(milestone.count).toBeGreaterThan(0);
            expect(milestone.count).toBeLessThanOrEqual(GACHA_CONFIG.CYCLE_LENGTH);
        }
        for (const count of Object.keys(GACHA_CONFIG.SPECIAL_MILESTONES).map(Number)) {
            expect(count).toBeGreaterThan(GACHA_CONFIG.CYCLE_LENGTH);
        }
    });

    it('keeps equipment synthesis possible for every non-legendary rarity and slot', () => {
        expect(SYNTHESIS_CONFIG.REQUIRED_COUNT).toBeGreaterThan(1);

        for (const rarity of RARITY_ORDER) {
            expect(SELL_XP_BY_RARITY[rarity]).toBeGreaterThan(0);
        }

        for (let i = 0; i < RARITY_ORDER.length - 1; i++) {
            const rarity = RARITY_ORDER[i];
            const nextRarity = RARITY_ORDER[i + 1];

            for (const slot of EQUIPMENT_SLOTS) {
                const hasIngredient = EQUIPMENT_POOL.some((item) => item.rarity === rarity && item.slot === slot);
                const hasResult = EQUIPMENT_POOL.some((item) => item.rarity === nextRarity && item.slot === slot);
                expect(hasIngredient, `${rarity}/${slot} ingredient exists`).toBe(true);
                expect(hasResult, `${nextRarity}/${slot} synthesis result exists`).toBe(true);
            }
        }
    });

    it('keeps equipment templates and image assets in sync', () => {
        const templateIds = EQUIPMENT_POOL.map((item) => item.id);
        const imageIds = Object.keys(ITEM_IMAGES);

        expect(new Set(templateIds).size).toBe(templateIds.length);
        expect([...imageIds].sort()).toEqual([...templateIds].sort());

        for (const item of EQUIPMENT_POOL) {
            expect(EQUIPMENT_SLOTS).toContain(item.slot);
            expect(RARITY_ORDER).toContain(item.rarity);
            expect(ITEM_IMAGES[item.id], `${item.id} image`).toEqual(expect.any(String));
            expect(ITEM_IMAGES[item.id].length, `${item.id} image path`).toBeGreaterThan(0);

            const bonuses = [item.attackBonus, item.defenseBonus, item.hpBonus];
            for (const bonus of bonuses) {
                expect(Number.isInteger(bonus), `${item.id} integer stat`).toBe(true);
                expect(bonus, `${item.id} non-negative stat`).toBeGreaterThanOrEqual(0);
            }
            expect(bonuses.some((bonus) => bonus > 0), `${item.id} has at least one bonus`).toBe(true);
        }
    });

    it('keeps chest reward types backed by image assets', () => {
        const chestTypes = Object.keys(GACHA_CONFIG.DROP_RATES) as ChestType[];

        for (const chestType of chestTypes) {
            expect(CHEST_IMAGES[chestType], `${chestType} image`).toEqual(expect.any(String));
            expect(CHEST_IMAGES[chestType].length, `${chestType} image path`).toBeGreaterThan(0);
        }

        expect(CHEST_FALLBACK_IMAGE).toBe(CHEST_IMAGES.wood);
    });

    it('keeps battle stages contiguous and mapped by map ranges', () => {
        const stages = BATTLE_CONFIG.STAGES.map((stage) => stage.stage);
        expect(stages[0]).toBe(1);
        for (let i = 1; i < stages.length; i++) {
            expect(stages[i]).toBe(stages[i - 1] + 1);
        }

        for (const stage of BATTLE_CONFIG.STAGES) {
            expect(stage.hp, `stage ${stage.stage} hp`).toBeGreaterThan(0);
            expect(stage.attack, `stage ${stage.stage} attack`).toBeGreaterThan(0);
            expect(stage.defense, `stage ${stage.stage} defense`).toBeGreaterThanOrEqual(0);
            expect(stage.xpReward, `stage ${stage.stage} reward`).toBeGreaterThan(0);
            expect(MAP_CONFIG.some((map) => stage.stage >= map.stageRange[0] && stage.stage <= map.stageRange[1])).toBe(true);
        }
    });

    it('keeps map ranges contiguous and non-overlapping', () => {
        const sortedMaps = [...MAP_CONFIG].sort((a, b) => a.stageRange[0] - b.stageRange[0]);
        expect(sortedMaps[0].stageRange[0]).toBe(1);
        for (let i = 1; i < sortedMaps.length; i++) {
            expect(sortedMaps[i].stageRange[0]).toBe(sortedMaps[i - 1].stageRange[1] + 1);
        }
        expect(sortedMaps[sortedMaps.length - 1].stageRange[1]).toBe(BATTLE_CONFIG.STAGES[BATTLE_CONFIG.STAGES.length - 1].stage);
    });
});
