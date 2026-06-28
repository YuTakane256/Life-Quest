import { describe, expect, it } from 'vitest';
import {
    MAX_CHEST_QUEUE_ITEMS,
    MAX_EQUIPMENT_ITEMS,
    MAX_GACHA_COUNT,
    MAX_TOTAL_XP,
    calculateLevel,
    calculateNextLevelXp,
    calculateXpProgress,
    sanitizeGameStoreState,
} from './useGameStore';
import { BATTLE_CONFIG, CHARACTER_CONFIG, EQUIPMENT_POOL, UI_CONFIG, XP_CONFIG } from '../config/gameConfig';

const TABLE = XP_CONFIG.LEVEL_XP_TABLE;
const MAX_TABLE_LEVEL = TABLE.length - 1; // 20
const OVERFLOW = XP_CONFIG.OVERFLOW_XP_PER_LEVEL; // 2000

describe('sanitizeGameStoreState', () => {
    it('非オブジェクトの永続化データは初期ゲーム状態にする', () => {
        const sanitized = sanitizeGameStoreState(null);

        expect(sanitized.character).toMatchObject({
            name: CHARACTER_CONFIG.INITIAL_STATS.name,
            avatar: CHARACTER_CONFIG.INITIAL_STATS.avatar,
            level: CHARACTER_CONFIG.INITIAL_STATS.level,
            totalXp: CHARACTER_CONFIG.INITIAL_STATS.totalXp,
            baseAttack: CHARACTER_CONFIG.INITIAL_STATS.attack,
            baseDefense: CHARACTER_CONFIG.INITIAL_STATS.defense,
            baseMaxHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp,
        });
        expect(sanitized.debuff.active).toBe(false);
        expect(sanitized.equipment).toEqual([]);
        expect(sanitized.gachaCount).toBe(0);
        expect(sanitized.chestQueue).toEqual([]);
        expect(sanitized.battle.status).toBe('idle');
    });

    it('キャラクターのレベルと基礎ステータスは totalXp から再計算する', () => {
        const totalXp = 1500;
        const level = calculateLevel(totalXp);
        const sanitized = sanitizeGameStoreState({
            character: {
                name: 'x'.repeat(UI_CONFIG.MAX_CHARACTER_NAME_LENGTH + 10),
                avatar: 'robot',
                level: 999,
                totalXp,
                baseAttack: 999999,
                baseDefense: 999999,
                baseMaxHp: 999999,
            },
        });

        expect(sanitized.character).toEqual({
            name: 'x'.repeat(UI_CONFIG.MAX_CHARACTER_NAME_LENGTH),
            avatar: CHARACTER_CONFIG.INITIAL_STATS.avatar,
            level,
            totalXp,
            baseAttack: CHARACTER_CONFIG.INITIAL_STATS.attack + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.attack,
            baseDefense: CHARACTER_CONFIG.INITIAL_STATS.defense + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.defense,
            baseMaxHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp,
        });
    });

    it('巨大なXPとガチャ回数は安全整数上限へ丸める', () => {
        const sanitized = sanitizeGameStoreState({
            character: { totalXp: Number.MAX_VALUE },
            gachaCount: Number.MAX_VALUE,
        });

        expect(sanitized.character.totalXp).toBe(MAX_TOTAL_XP);
        expect(sanitized.character.level).toBe(calculateLevel(MAX_TOTAL_XP));
        expect(sanitized.gachaCount).toBe(MAX_GACHA_COUNT);
        expect(Number.isSafeInteger(sanitized.character.baseMaxHp)).toBe(true);
    });

    it('装備は既知テンプレートから性能を復元し、同スロットの複数装備を解除する', () => {
        const weaponTemplates = EQUIPMENT_POOL.filter((template) => template.slot === 'weapon');
        const firstWeapon = weaponTemplates[0];
        const secondWeapon = weaponTemplates[1];

        const sanitized = sanitizeGameStoreState({
            equipment: [
                {
                    id: 'eq-1',
                    templateId: firstWeapon.id,
                    name: '改ざん装備',
                    slot: 'accessory',
                    rarity: 'legendary',
                    attackBonus: 999999,
                    defenseBonus: 999999,
                    hpBonus: 999999,
                    equipped: true,
                },
                {
                    id: 'eq-2',
                    templateId: secondWeapon.id,
                    equipped: true,
                },
                {
                    id: 'eq-1',
                    templateId: secondWeapon.id,
                    equipped: false,
                },
                {
                    id: 'eq-bad',
                    templateId: 'missing-template',
                    equipped: true,
                },
            ],
        });

        expect(sanitized.equipment).toEqual([
            {
                id: 'eq-1',
                templateId: firstWeapon.id,
                name: firstWeapon.name,
                slot: firstWeapon.slot,
                rarity: firstWeapon.rarity,
                attackBonus: firstWeapon.attackBonus,
                defenseBonus: firstWeapon.defenseBonus,
                hpBonus: firstWeapon.hpBonus,
                equipped: true,
            },
            {
                id: 'eq-2',
                templateId: secondWeapon.id,
                name: secondWeapon.name,
                slot: secondWeapon.slot,
                rarity: secondWeapon.rarity,
                attackBonus: secondWeapon.attackBonus,
                defenseBonus: secondWeapon.defenseBonus,
                hpBonus: secondWeapon.hpBonus,
                equipped: false,
            },
        ]);
    });

    it('宝箱・敵・バトルログを検証して既知データへ丸める', () => {
        const template = EQUIPMENT_POOL[0];
        const stageData = BATTLE_CONFIG.STAGES[0];
        const sanitized = sanitizeGameStoreState({
            chestQueue: [
                {
                    id: 'chest-1',
                    chestType: 'gold',
                    label: 'l'.repeat(130),
                    opened: true,
                    equipment: {
                        id: 'eq-1',
                        templateId: template.id,
                        attackBonus: 999999,
                    },
                },
                { id: 'chest-bad', chestType: 'admin', label: 'bad' },
            ],
            battle: {
                status: 'fighting',
                currentStage: 999,
                maxClearedStage: 999,
                enemy: {
                    stage: stageData.stage,
                    hp: 999999,
                    maxHp: 999999,
                    attack: 999999,
                    defense: 999999,
                    xpReward: 999999,
                },
                playerHp: 999999,
                logs: [
                    { turn: 1, message: 'm'.repeat(220), playerHp: 20, enemyHp: 10 },
                    { turn: 2, message: 123, playerHp: 20, enemyHp: 10 },
                ],
                battleUnlocked: true,
            },
        });

        expect(sanitized.chestQueue).toHaveLength(1);
        expect(sanitized.chestQueue[0].label).toHaveLength(120);
        expect(sanitized.chestQueue[0].equipment?.attackBonus).toBe(template.attackBonus);
        expect(sanitized.battle).toMatchObject({
            status: 'fighting',
            currentStage: BATTLE_CONFIG.STAGES[BATTLE_CONFIG.STAGES.length - 1].stage,
            maxClearedStage: BATTLE_CONFIG.STAGES[BATTLE_CONFIG.STAGES.length - 1].stage,
            playerHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp,
            battleUnlocked: true,
        });
        expect(sanitized.battle.enemy).toMatchObject({
            stage: stageData.stage,
            name: stageData.name,
            hp: stageData.hp,
            maxHp: stageData.hp,
            attack: stageData.attack,
            defense: stageData.defense,
            xpReward: stageData.xpReward,
        });
        expect(sanitized.battle.logs).toHaveLength(1);
        expect(sanitized.battle.logs[0].message).toHaveLength(200);
    });

    it('戦闘中ステータスで敵が復元できない場合は idle に戻す', () => {
        const sanitized = sanitizeGameStoreState({
            battle: {
                status: 'fighting',
                enemy: { stage: 'broken' },
            },
        });

        expect(sanitized.battle.status).toBe('idle');
        expect(sanitized.battle.enemy).toBeNull();
    });

    it('装備上限を超えた場合は装備中アイテムと新しい未装備品を優先する', () => {
        const template = EQUIPMENT_POOL[0];
        const equipment = Array.from({ length: MAX_EQUIPMENT_ITEMS + 2 }, (_, index) => ({
            id: `eq-${index}`,
            templateId: template.id,
            equipped: index === 0,
        }));

        const sanitized = sanitizeGameStoreState({ equipment });

        expect(sanitized.equipment).toHaveLength(MAX_EQUIPMENT_ITEMS);
        expect(sanitized.equipment.some((item) => item.id === 'eq-0' && item.equipped)).toBe(true);
        expect(sanitized.equipment.some((item) => item.id === 'eq-1')).toBe(false);
        expect(sanitized.equipment.some((item) => item.id === `eq-${MAX_EQUIPMENT_ITEMS + 1}`)).toBe(true);
    });

    it('宝箱上限を超えた場合は未開封と新しい開封済み宝箱を優先する', () => {
        const chestQueue = Array.from({ length: MAX_CHEST_QUEUE_ITEMS + 2 }, (_, index) => ({
            id: `chest-${index}`,
            chestType: 'wood',
            label: `${index}`,
            opened: index !== 0,
            equipment: null,
        }));

        const sanitized = sanitizeGameStoreState({ chestQueue });

        expect(sanitized.chestQueue).toHaveLength(MAX_CHEST_QUEUE_ITEMS);
        expect(sanitized.chestQueue.some((chest) => chest.id === 'chest-0' && !chest.opened)).toBe(true);
        expect(sanitized.chestQueue.some((chest) => chest.id === 'chest-1')).toBe(false);
        expect(sanitized.chestQueue.some((chest) => chest.id === `chest-${MAX_CHEST_QUEUE_ITEMS + 1}`)).toBe(true);
    });
});

describe('calculateLevel', () => {
    it('XP 0 はレベル 1', () => {
        expect(calculateLevel(0)).toBe(1);
    });

    it('テーブルの各境界値で対応レベルを返す', () => {
        // Lv1 → 0, Lv2 → 30, ..., Lv20 → 12000
        for (let level = 1; level <= MAX_TABLE_LEVEL; level++) {
            expect(calculateLevel(TABLE[level])).toBe(level);
        }
    });

    it('レベル間の中間XPは下のレベルを返す', () => {
        // Lv2 = 30, Lv3 = 80。50 XP は Lv2 のまま
        expect(calculateLevel(50)).toBe(2);
        // Lv5 = 250, Lv6 = 400。399 XP は Lv5
        expect(calculateLevel(399)).toBe(5);
    });

    it('テーブル上限超過時はオーバーフロー計算 (+OVERFLOW で +1)', () => {
        // 12000 XP = Lv20
        expect(calculateLevel(TABLE[MAX_TABLE_LEVEL])).toBe(MAX_TABLE_LEVEL);
        // 12000 + 2000 = 14000 → Lv21
        expect(calculateLevel(TABLE[MAX_TABLE_LEVEL] + OVERFLOW)).toBe(MAX_TABLE_LEVEL + 1);
        // 12000 + 2000*5 = 22000 → Lv25
        expect(calculateLevel(TABLE[MAX_TABLE_LEVEL] + OVERFLOW * 5)).toBe(MAX_TABLE_LEVEL + 5);
    });

    it('オーバーフロー領域の中間XPは下のレベル', () => {
        // Lv20 = 12000, Lv21 開始 = 14000。13000 → まだ Lv20
        expect(calculateLevel(TABLE[MAX_TABLE_LEVEL] + 1000)).toBe(MAX_TABLE_LEVEL);
    });

    it('負の値ではレベル 1 を返す（安全な下限）', () => {
        // 仕様: 表にマッチしないので最終的に return 1 にフォールスルー
        expect(calculateLevel(-100)).toBe(1);
    });
});

describe('calculateNextLevelXp', () => {
    it('Lv1 → 次レベルは TABLE[2]', () => {
        expect(calculateNextLevelXp(1)).toBe(TABLE[2]);
    });

    it('テーブル中のレベルは TABLE[level + 1] を返す', () => {
        for (let level = 1; level < MAX_TABLE_LEVEL; level++) {
            expect(calculateNextLevelXp(level)).toBe(TABLE[level + 1]);
        }
    });

    it('テーブル上限 (Lv20) はオーバーフロー計算', () => {
        // 12000 + (20 - 20 + 1) * 2000 = 14000
        expect(calculateNextLevelXp(MAX_TABLE_LEVEL)).toBe(TABLE[MAX_TABLE_LEVEL] + OVERFLOW);
    });

    it('テーブル超過レベルもオーバーフロー線形', () => {
        // Lv25 → 12000 + (25 - 20 + 1) * 2000 = 24000
        expect(calculateNextLevelXp(MAX_TABLE_LEVEL + 5)).toBe(TABLE[MAX_TABLE_LEVEL] + OVERFLOW * 6);
    });

    it('calculateLevel と往復一致する（テーブル内）', () => {
        // calculateLevel(calculateNextLevelXp(L)) === L + 1
        for (let level = 1; level < MAX_TABLE_LEVEL; level++) {
            expect(calculateLevel(calculateNextLevelXp(level))).toBe(level + 1);
        }
    });
});

describe('calculateXpProgress', () => {
    it('レベル開始ちょうどなら 0', () => {
        // Lv2 開始 XP = 30
        expect(calculateXpProgress(TABLE[2], 2)).toBe(0);
    });

    it('レベル中盤は 0 ≤ progress < 1', () => {
        // Lv2 = 30, Lv3 = 80。XP=55 → (55-30)/(80-30) = 0.5
        expect(calculateXpProgress(55, 2)).toBeCloseTo(0.5, 5);
    });

    it('次レベル直前は 1 に近い', () => {
        // Lv3 = 80。XP=79 → (79-30)/(80-30) = 0.98
        expect(calculateXpProgress(79, 2)).toBeCloseTo(0.98, 5);
    });

    it('オーバーフロー領域でも 0 ≤ progress < 1', () => {
        // Lv20 base = 12000、Lv21 base = 14000。XP=13000, level=20 → 0.5
        const progress = calculateXpProgress(TABLE[MAX_TABLE_LEVEL] + 1000, MAX_TABLE_LEVEL);
        expect(progress).toBeCloseTo(0.5, 5);
    });

    it('オーバーフロー領域の上位レベル', () => {
        // level=25 → base = 12000 + (25-20)*2000 = 22000, next = 24000
        // XP=23000 → 0.5
        const progress = calculateXpProgress(TABLE[MAX_TABLE_LEVEL] + OVERFLOW * 5 + 1000, MAX_TABLE_LEVEL + 5);
        expect(progress).toBeCloseTo(0.5, 5);
    });
});
