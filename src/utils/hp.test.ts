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

describe('getHpBarA11y', () => {
    it('returns ARIA progressbar values for a normal HP state', () => {
        expect(getHpBarA11y(25, 100)).toEqual({ valueNow: 25, valueMax: 100, valueText: '25 / 100' });
    });

    it('clamps overheal (current > max) the same as getHpDisplayState', () => {
        expect(getHpBarA11y(150, 100)).toEqual({ valueNow: 100, valueMax: 100, valueText: '100 / 100' });
    });

    it('clamps negative current to zero', () => {
        expect(getHpBarA11y(-10, 100)).toEqual({ valueNow: 0, valueMax: 100, valueText: '0 / 100' });
    });

    it('zero or negative max HP yields valueMax=0 (caller must omit the progressbar role in this case)', () => {
        expect(getHpBarA11y(10, 0)).toEqual({ valueNow: 0, valueMax: 0, valueText: '0 / 0' });
        expect(getHpBarA11y(10, -5)).toEqual({ valueNow: 0, valueMax: 0, valueText: '0 / 0' });
    });

    it('floors fractional values and ignores non-finite numbers', () => {
        expect(getHpBarA11y(12.9, 20.9)).toEqual({ valueNow: 12, valueMax: 20, valueText: '12 / 20' });
        expect(getHpBarA11y(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ valueNow: 0, valueMax: 0, valueText: '0 / 0' });
    });
});
