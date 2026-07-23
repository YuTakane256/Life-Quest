import { describe, expect, it } from 'vitest';
import { getProgressBarA11y } from './progressBar';

describe('getProgressBarA11y', () => {
    it('returns a normal state with the default "now / max" text', () => {
        expect(getProgressBarA11y(3, 5)).toEqual({ valueNow: 3, valueMax: 5, valueText: '3 / 5' });
    });

    it('clamps valueNow above valueMax (e.g. achievement current exceeding target)', () => {
        expect(getProgressBarA11y(500, 30)).toEqual({ valueNow: 30, valueMax: 30, valueText: '30 / 30' });
    });

    it('clamps negative valueNow to zero', () => {
        expect(getProgressBarA11y(-10, 5)).toEqual({ valueNow: 0, valueMax: 5, valueText: '0 / 5' });
    });

    it('treats zero or negative valueMax as empty (no valid progressbar range)', () => {
        expect(getProgressBarA11y(3, 0)).toEqual({ valueNow: 0, valueMax: 0, valueText: '0 / 0' });
        expect(getProgressBarA11y(3, -5)).toEqual({ valueNow: 0, valueMax: 0, valueText: '0 / 0' });
    });

    it('floors fractional values and ignores non-finite numbers', () => {
        expect(getProgressBarA11y(2.9, 5.9)).toEqual({ valueNow: 2, valueMax: 5, valueText: '2 / 5' });
        expect(getProgressBarA11y(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ valueNow: 0, valueMax: 0, valueText: '0 / 0' });
    });

    it('uses a custom valueTextFormat when provided, receiving the clamped values', () => {
        const result = getProgressBarA11y(500, 30, (now, max) => `達成・${now}/${max}`);
        expect(result).toEqual({ valueNow: 30, valueMax: 30, valueText: '達成・30/30' });
    });

    it('calls valueTextFormat with (0, 0) when valueMax is non-positive', () => {
        const result = getProgressBarA11y(3, 0, (now, max) => `custom:${now}:${max}`);
        expect(result).toEqual({ valueNow: 0, valueMax: 0, valueText: 'custom:0:0' });
    });
});
