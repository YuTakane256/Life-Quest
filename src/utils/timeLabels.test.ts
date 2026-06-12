import { describe, expect, it } from 'vitest';
import { formatHourLabel, formatReminderHourLabel } from './timeLabels';

describe('timeLabels', () => {
    describe('formatHourLabel', () => {
        it('formats hours with two digits', () => {
            expect(formatHourLabel(0)).toBe('00:00');
            expect(formatHourLabel(8)).toBe('08:00');
            expect(formatHourLabel(23)).toBe('23:00');
        });

        it('floors decimals and clamps out-of-range values', () => {
            expect(formatHourLabel(7.9)).toBe('07:00');
            expect(formatHourLabel(-3)).toBe('00:00');
            expect(formatHourLabel(30)).toBe('23:00');
            expect(formatHourLabel(Number.NaN)).toBe('00:00');
        });
    });

    describe('formatReminderHourLabel', () => {
        it('adds the reminder suffix', () => {
            expect(formatReminderHourLabel(20)).toBe('20:00以降');
        });
    });
});
