import { describe, expect, it } from 'vitest';
import { getHpDisplayState } from './hp.ts';

describe('getHpDisplayState', () => {
    it('通常の比率とパーセント表示を返す', () => {
        expect(getHpDisplayState(25, 100)).toEqual({
            current: 25,
            max: 100,
            ratio: 0.25,
            widthPercent: '25%',
        });
    });

    it('割り切れない比率でも小数のwidthPercentを返す', () => {
        const state = getHpDisplayState(1, 3);
        expect(state.current).toBe(1);
        expect(state.max).toBe(3);
        expect(state.ratio).toBeCloseTo(1 / 3);
        expect(state.widthPercent).toBe(`${(1 / 3) * 100}%`);
    });

    it('currentがmaxを超えるとmaxにクランプする', () => {
        expect(getHpDisplayState(150, 100)).toEqual({
            current: 100,
            max: 100,
            ratio: 1,
            widthPercent: '100%',
        });
    });

    it('currentが負の値は0にクランプする', () => {
        expect(getHpDisplayState(-10, 100)).toEqual({
            current: 0,
            max: 100,
            ratio: 0,
            widthPercent: '0%',
        });
    });

    it('maxが0または負の値は全てゼロ状態にする', () => {
        expect(getHpDisplayState(10, 0)).toEqual({ current: 0, max: 0, ratio: 0, widthPercent: '0%' });
        expect(getHpDisplayState(10, -5)).toEqual({ current: 0, max: 0, ratio: 0, widthPercent: '0%' });
    });

    it('非有限値（NaN・Infinity）は0として正規化される', () => {
        expect(getHpDisplayState(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
            current: 0, max: 0, ratio: 0, widthPercent: '0%',
        });
    });

    it('小数のcurrent/maxは切り捨てて計算する', () => {
        expect(getHpDisplayState(12.9, 20.9)).toEqual({
            current: 12, max: 20, ratio: 0.6, widthPercent: '60%',
        });
    });
});
