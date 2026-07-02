import { describe, it, expect } from 'vitest';
import {
    EQUIPMENT_POOL,
    GACHA_CONFIG,
    getMilestoneAtCount,
    rollEquipmentTemplate,
    SELL_XP_BY_RARITY,
    type ChestType,
} from './rewards';
import { EQUIPMENT_RARITIES } from './equipment';

describe('getMilestoneAtCount', () => {
    it('サイクル内のマイルストーンで宝箱を返す', () => {
        expect(getMilestoneAtCount(5)).toMatchObject({ count: 5, chestType: 'blue' });
        expect(getMilestoneAtCount(10)).toMatchObject({ chestType: 'wood' });
        expect(getMilestoneAtCount(25)).toMatchObject({ chestType: 'wood' });
        expect(getMilestoneAtCount(50)).toMatchObject({ chestType: 'silver' });
        expect(getMilestoneAtCount(100)).toMatchObject({ chestType: 'gold' });
    });

    it('マイルストーン以外のカウントでは null を返す', () => {
        expect(getMilestoneAtCount(1)).toBeNull();
        expect(getMilestoneAtCount(6)).toBeNull();
        expect(getMilestoneAtCount(99)).toBeNull();
    });

    it('2サイクル目以降も同じ位置でマイルストーンに到達する', () => {
        expect(getMilestoneAtCount(105)).toMatchObject({ count: 105, chestType: 'blue' });
        expect(getMilestoneAtCount(150)).toMatchObject({ chestType: 'silver' });
        expect(getMilestoneAtCount(200)).toMatchObject({ chestType: 'gold' });
        expect(getMilestoneAtCount(300)).toMatchObject({ chestType: 'gold' });
    });

    it('特殊マイルストーンがサイクル判定より優先される', () => {
        expect(getMilestoneAtCount(500)).toMatchObject({ chestType: 'red_gold', label: '赤と金の宝箱' });
        expect(getMilestoneAtCount(1000)).toMatchObject({ chestType: 'rainbow', label: '虹色の宝箱' });
    });

    it('0以下や整数でない値には null を返す', () => {
        expect(getMilestoneAtCount(0)).toBeNull();
        expect(getMilestoneAtCount(-5)).toBeNull();
        expect(getMilestoneAtCount(5.5)).toBeNull();
        expect(getMilestoneAtCount(Number.NaN)).toBeNull();
    });
});

describe('GACHA_CONFIG.DROP_RATES の整合性', () => {
    it.each(Object.entries(GACHA_CONFIG.DROP_RATES))('%s の確率合計は1.0', (_chestType, rates) => {
        const total = Object.values<number>(rates).reduce((sum, rate) => sum + rate, 0);
        expect(total).toBeCloseTo(1.0, 10);
    });

    it('全レアリティにプールの装備テンプレートが存在する', () => {
        for (const rarity of EQUIPMENT_RARITIES) {
            expect(EQUIPMENT_POOL.some((template) => template.rarity === rarity)).toBe(true);
        }
    });

    it('売却XPはレアリティ昇順で単調増加する', () => {
        const values = EQUIPMENT_RARITIES.map((rarity) => SELL_XP_BY_RARITY[rarity]);
        for (let i = 1; i < values.length; i++) {
            expect(values[i]).toBeGreaterThan(values[i - 1]);
        }
    });
});

describe('rollEquipmentTemplate', () => {
    it('スターターキャラ確定の青宝箱は装備を排出しない', () => {
        expect(rollEquipmentTemplate('blue', () => 0.5)).toBeNull();
    });

    it('虹色の宝箱はどの乱数でも legendary を排出する', () => {
        for (const roll of [0, 0.3, 0.7, 0.999]) {
            const template = rollEquipmentTemplate('rainbow', () => roll);
            expect(template?.rarity).toBe('legendary');
        }
    });

    it('注入した乱数に応じて排出レアリティが決まる（wood）', () => {
        // wood: common 0.60 / uncommon 0.30 / rare 0.08 / epic 0.02
        expect(rollEquipmentTemplate('wood', () => 0.10)?.rarity).toBe('common');
        expect(rollEquipmentTemplate('wood', () => 0.75)?.rarity).toBe('uncommon');
        expect(rollEquipmentTemplate('wood', () => 0.95)?.rarity).toBe('rare');
        expect(rollEquipmentTemplate('wood', () => 0.995)?.rarity).toBe('epic');
    });

    it('乱数0でも確率0のレアリティは選ばれない（red_gold は common を排出しない）', () => {
        // red_gold: common 0 / uncommon 0.05 / ...
        expect(rollEquipmentTemplate('red_gold', () => 0)?.rarity).toBe('uncommon');
    });

    it('同じ乱数列なら同じテンプレートを返す（決定性）', () => {
        const sequence = () => {
            const values = [0.5, 0.5];
            return () => values.shift() ?? 0;
        };
        const first = rollEquipmentTemplate('gold', sequence());
        const second = rollEquipmentTemplate('gold', sequence());
        expect(first).toEqual(second);
        expect(first).not.toBeNull();
    });

    it('排出されるテンプレートは選択レアリティのプールに含まれる', () => {
        const chestTypes: ChestType[] = ['wood', 'silver', 'gold', 'red_gold', 'rainbow'];
        for (const chestType of chestTypes) {
            const template = rollEquipmentTemplate(chestType, Math.random);
            expect(template).not.toBeNull();
            expect(EQUIPMENT_POOL).toContainEqual(template);
        }
    });
});
