import { describe, expect, it } from 'vitest';
import { calculateLevel, calculateNextLevelXp, calculateXpProgress } from './useGameStore';
import { XP_CONFIG } from '../config/gameConfig';

const TABLE = XP_CONFIG.LEVEL_XP_TABLE;
const MAX_TABLE_LEVEL = TABLE.length - 1; // 20
const OVERFLOW = XP_CONFIG.OVERFLOW_XP_PER_LEVEL; // 2000

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
