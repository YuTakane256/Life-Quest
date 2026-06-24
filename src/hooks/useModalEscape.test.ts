import { describe, expect, it } from 'vitest';
import { shouldHandleModalEscape } from './useModalEscape';

describe('shouldHandleModalEscape', () => {
    it('handles normal Escape key events', () => {
        expect(shouldHandleModalEscape(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
    });

    it('ignores non-Escape key events', () => {
        expect(shouldHandleModalEscape(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);
    });

    it('ignores Escape while IME composition is active', () => {
        expect(shouldHandleModalEscape(new KeyboardEvent('keydown', {
            key: 'Escape',
            isComposing: true,
        }))).toBe(false);
    });

    it('ignores Escape events that were already prevented', () => {
        const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        event.preventDefault();

        expect(shouldHandleModalEscape(event)).toBe(false);
    });
});
