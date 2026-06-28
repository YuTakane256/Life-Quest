import { describe, it, expect } from 'vitest';
import {
    isPlainObject,
    isFiniteNumber,
    toNonNegativeInteger,
    toBoundedInteger,
    sanitizeNullableYmd,
    sanitizeTimestamp,
    sanitizeNullableTimestamp,
} from './persistSanitize';

describe('isPlainObject', () => {
    it('プレーンオブジェクトを受理する', () => expect(isPlainObject({ a: 1 })).toBe(true));
    it('配列を拒否する', () => expect(isPlainObject([])).toBe(false));
    it('nullを拒否する', () => expect(isPlainObject(null)).toBe(false));
    it('プリミティブを拒否する', () => expect(isPlainObject(42)).toBe(false));
});

describe('isFiniteNumber', () => {
    it('有限数を受理する', () => expect(isFiniteNumber(3)).toBe(true));
    it('NaNを拒否する', () => expect(isFiniteNumber(Number.NaN)).toBe(false));
    it('Infinityを拒否する', () => expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false));
    it('数値文字列を拒否する', () => expect(isFiniteNumber('3')).toBe(false));
});

describe('toNonNegativeInteger', () => {
    it('正の小数を切り捨てる', () => expect(toNonNegativeInteger(3.9)).toBe(3));
    it('負値は0になる', () => expect(toNonNegativeInteger(-5)).toBe(0));
    it('数値でなければfallbackを返す', () => expect(toNonNegativeInteger('x', 7)).toBe(7));
    it('NaNはfallbackを返す', () => expect(toNonNegativeInteger(Number.NaN, 2)).toBe(2));
    it('fallback省略時は0', () => expect(toNonNegativeInteger(undefined)).toBe(0));
});

describe('toBoundedInteger', () => {
    it('範囲内は切り捨てて返す', () => expect(toBoundedInteger(5.7, 0, 1, 10)).toBe(5));
    it('下限未満は下限に丸める', () => expect(toBoundedInteger(-3, 0, 1, 10)).toBe(1));
    it('上限超過は上限に丸める', () => expect(toBoundedInteger(50, 0, 1, 10)).toBe(10));
    it('数値でなければfallbackを返す', () => expect(toBoundedInteger('x', 4, 1, 10)).toBe(4));
});

describe('sanitizeNullableYmd', () => {
    it('妥当なYMDを保持する', () => expect(sanitizeNullableYmd('2026-06-27')).toBe('2026-06-27'));
    it('実在しない日付はnull', () => expect(sanitizeNullableYmd('2026-13-01')).toBeNull());
    it('文字列でなければnull', () => expect(sanitizeNullableYmd(123)).toBeNull());
});

describe('sanitizeTimestamp', () => {
    const iso = '2026-06-27T12:00:00.000Z';
    it('妥当なISO日時を保持する', () => expect(sanitizeTimestamp(iso)).toBe(iso));
    it('不正な文字列はfallbackを返す', () => expect(sanitizeTimestamp('nope', 'FB')).toBe('FB'));
    it('文字列でなければfallbackを返す', () => expect(sanitizeTimestamp(null, 'FB')).toBe('FB'));
});

describe('sanitizeNullableTimestamp', () => {
    const iso = '2026-06-27T12:00:00.000Z';
    it('妥当なISO日時を保持する', () => expect(sanitizeNullableTimestamp(iso)).toBe(iso));
    it('不正な文字列はnull', () => expect(sanitizeNullableTimestamp('nope')).toBeNull());
});
