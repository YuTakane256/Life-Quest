import { describe, expect, it } from 'vitest';
import { getHpBarA11y, getProgressBarA11y } from './progressA11y';

describe('getHpBarA11y', () => {
    it('returns current/max/text for a normal HP state', () => {
        expect(getHpBarA11y(25, 100)).toEqual({ current: 25, max: 100, text: '25 / 100' });
    });

    it('clamps overheal (current > max) the same as getHpDisplayState', () => {
        expect(getHpBarA11y(150, 100)).toEqual({ current: 100, max: 100, text: '100 / 100' });
    });

    it('clamps negative current to zero', () => {
        expect(getHpBarA11y(-10, 100)).toEqual({ current: 0, max: 100, text: '0 / 100' });
    });

    it('zero or negative max HP yields max=0', () => {
        expect(getHpBarA11y(10, 0)).toEqual({ current: 0, max: 0, text: '0 / 0' });
        expect(getHpBarA11y(10, -5)).toEqual({ current: 0, max: 0, text: '0 / 0' });
    });

    it('floors fractional values and ignores non-finite numbers', () => {
        expect(getHpBarA11y(12.9, 20.9)).toEqual({ current: 12, max: 20, text: '12 / 20' });
        expect(getHpBarA11y(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ current: 0, max: 0, text: '0 / 0' });
    });
});

describe('getProgressBarA11y', () => {
    it('returns a normal state with the default "current / max" text', () => {
        expect(getProgressBarA11y(3, 5)).toEqual({ current: 3, max: 5, text: '3 / 5' });
    });

    it('clamps current above max (e.g. achievement current exceeding target)', () => {
        expect(getProgressBarA11y(500, 30)).toEqual({ current: 30, max: 30, text: '30 / 30' });
    });

    it('clamps negative current to zero', () => {
        expect(getProgressBarA11y(-10, 5)).toEqual({ current: 0, max: 5, text: '0 / 5' });
    });

    it('treats zero or negative max as empty (no valid progressbar range)', () => {
        expect(getProgressBarA11y(3, 0)).toEqual({ current: 0, max: 0, text: '0 / 0' });
        expect(getProgressBarA11y(3, -5)).toEqual({ current: 0, max: 0, text: '0 / 0' });
    });

    it('floors fractional values and ignores non-finite numbers', () => {
        expect(getProgressBarA11y(2.9, 5.9)).toEqual({ current: 2, max: 5, text: '2 / 5' });
        expect(getProgressBarA11y(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ current: 0, max: 0, text: '0 / 0' });
    });

    it('uses a custom textFormat when provided, receiving the clamped values', () => {
        const result = getProgressBarA11y(500, 30, (current, max) => `達成・${current}/${max}`);
        expect(result).toEqual({ current: 30, max: 30, text: '達成・30/30' });
    });

    it('calls textFormat with (0, 0) when max is non-positive', () => {
        const result = getProgressBarA11y(3, 0, (current, max) => `custom:${current}:${max}`);
        expect(result).toEqual({ current: 0, max: 0, text: 'custom:0:0' });
    });
});
