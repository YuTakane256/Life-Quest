import { describe, expect, it } from 'vitest';
import { clamp, nonNegativeInteger, nonNegativeRatio, positiveInteger } from './numeric.ts';

describe('clamp', () => {
    it('範囲内の値はそのまま返す', () => {
        expect(clamp(5, 0, 10)).toBe(5);
    });

    it('下限未満は下限にクランプする', () => {
        expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('上限超過は上限にクランプする', () => {
        expect(clamp(15, 0, 10)).toBe(10);
    });

    it('境界値（min・maxちょうど）はそのまま返す', () => {
        expect(clamp(0, 0, 10)).toBe(0);
        expect(clamp(10, 0, 10)).toBe(10);
    });
});

describe('nonNegativeInteger', () => {
    it('正の小数は切り捨てる', () => {
        expect(nonNegativeInteger(3.9)).toBe(3);
    });

    it('負の値は0にする', () => {
        expect(nonNegativeInteger(-5)).toBe(0);
    });

    it('0はそのまま0', () => {
        expect(nonNegativeInteger(0)).toBe(0);
    });

    it('非有限値（NaN・Infinity・-Infinity）は0にする', () => {
        expect(nonNegativeInteger(Number.NaN)).toBe(0);
        expect(nonNegativeInteger(Number.POSITIVE_INFINITY)).toBe(0);
        expect(nonNegativeInteger(Number.NEGATIVE_INFINITY)).toBe(0);
    });
});

describe('nonNegativeRatio', () => {
    it('正の小数はそのまま返す（floorしない）', () => {
        expect(nonNegativeRatio(0.5)).toBe(0.5);
    });

    it('負の値は0にする', () => {
        expect(nonNegativeRatio(-0.5)).toBe(0);
    });

    it('非有限値（NaN・Infinity）は0にする', () => {
        expect(nonNegativeRatio(Number.NaN)).toBe(0);
        expect(nonNegativeRatio(Number.POSITIVE_INFINITY)).toBe(0);
    });
});

describe('positiveInteger', () => {
    it('正の小数は切り捨てる', () => {
        expect(positiveInteger(3.9)).toBe(3);
    });

    it('0は1にフォールバックする', () => {
        expect(positiveInteger(0)).toBe(1);
    });

    it('負の値は1にフォールバックする', () => {
        expect(positiveInteger(-5)).toBe(1);
    });

    it('非有限値（NaN・Infinity）は1にフォールバックする', () => {
        expect(positiveInteger(Number.NaN)).toBe(1);
        expect(positiveInteger(Number.POSITIVE_INFINITY)).toBe(1);
    });
});
