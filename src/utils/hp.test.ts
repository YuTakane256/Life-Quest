import { describe, expect, it } from 'vitest';
import { getHpDisplayState, getHpBarA11y } from './hp';

describe('getHpDisplayState', () => {
    it('returns a normal ratio and percentage for valid HP values', () => {
        expect(getHpDisplayState(25, 100)).toEqual({
            current: 25,
            max: 100,
            ratio: 0.25,
            widthPercent: '25%',
        });
    });

    it('clamps current HP below zero', () => {
        expect(getHpDisplayState(-10, 100)).toEqual({
            current: 0,
            max: 100,
            ratio: 0,
            widthPercent: '0%',
        });
    });

    it('clamps current HP above max', () => {
        expect(getHpDisplayState(150, 100)).toEqual({
            current: 100,
            max: 100,
            ratio: 1,
            widthPercent: '100%',
        });
    });

    it('treats zero or negative max HP as empty', () => {
        expect(getHpDisplayState(10, 0)).toMatchObject({ current: 0, max: 0, ratio: 0, widthPercent: '0%' });
        expect(getHpDisplayState(10, -5)).toMatchObject({ current: 0, max: 0, ratio: 0, widthPercent: '0%' });
    });

    it('floors fractional values and ignores non-finite numbers', () => {
        expect(getHpDisplayState(12.9, 20.9)).toMatchObject({ current: 12, max: 20, ratio: 0.6, widthPercent: '60%' });
        expect(getHpDisplayState(Number.NaN, Number.POSITIVE_INFINITY)).toMatchObject({ current: 0, max: 0, ratio: 0, widthPercent: '0%' });
    });
});

describe('getHpBarA11y（再エクスポートのスモークテスト。ロジック本体はpackages/core/src/progressA11y.test.tsで検証）', () => {
    it('returns current/max/text for a normal HP state', () => {
        expect(getHpBarA11y(25, 100)).toEqual({ current: 25, max: 100, text: '25 / 100' });
    });
});
