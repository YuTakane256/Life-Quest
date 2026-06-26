import { describe, it, expect } from 'vitest';
import { clamp, nonNegativeInteger, nonNegativeRatio, positiveInteger } from './numeric';

describe('clamp', () => {
    it('範囲内の値はそのまま返す', () => expect(clamp(5, 0, 10)).toBe(5));
    it('下限未満は下限に丸める', () => expect(clamp(-1, 0, 10)).toBe(0));
    it('上限超過は上限に丸める', () => expect(clamp(99, 0, 10)).toBe(10));
});

describe('nonNegativeInteger', () => {
    it('正の小数は切り捨てる', () => expect(nonNegativeInteger(3.9)).toBe(3));
    it('負値は0になる', () => expect(nonNegativeInteger(-5)).toBe(0));
    it('NaNは0になる', () => expect(nonNegativeInteger(Number.NaN)).toBe(0));
    it('Infinityは0になる', () => expect(nonNegativeInteger(Number.POSITIVE_INFINITY)).toBe(0));
});

describe('nonNegativeRatio', () => {
    it('正の小数を保持する', () => expect(nonNegativeRatio(1.5)).toBe(1.5));
    it('負値は0になる', () => expect(nonNegativeRatio(-0.2)).toBe(0));
    it('NaNは0になる', () => expect(nonNegativeRatio(Number.NaN)).toBe(0));
});

describe('positiveInteger', () => {
    it('正の小数は切り捨てる', () => expect(positiveInteger(4.7)).toBe(4));
    it('0は1にフォールバックする', () => expect(positiveInteger(0)).toBe(1));
    it('負値は1にフォールバックする', () => expect(positiveInteger(-3)).toBe(1));
    it('NaNは1にフォールバックする', () => expect(positiveInteger(Number.NaN)).toBe(1));
});
