import { describe, expect, it } from 'vitest';
import { normalizeFallbackPath } from './useBackWithFallback';

describe('normalizeFallbackPath', () => {
    it('keeps safe internal absolute app paths', () => {
        expect(normalizeFallbackPath('/tasks')).toBe('/tasks');
        expect(normalizeFallbackPath('/settings')).toBe('/settings');
        expect(normalizeFallbackPath(' /character/inventory ')).toBe('/character/inventory');
        expect(normalizeFallbackPath('/tasks?filter=today')).toBe('/tasks?filter=today');
    });

    it('falls back for external or protocol-like paths', () => {
        expect(normalizeFallbackPath('https://example.com')).toBe('/tasks');
        expect(normalizeFallbackPath('mailto:test@example.com')).toBe('/tasks');
        expect(normalizeFallbackPath('//example.com/path')).toBe('/tasks');
    });

    it('falls back for malformed values', () => {
        expect(normalizeFallbackPath('')).toBe('/tasks');
        expect(normalizeFallbackPath('settings')).toBe('/tasks');
        expect(normalizeFallbackPath('/settings\\evil')).toBe('/tasks');
        expect(normalizeFallbackPath('/settings\nnext')).toBe('/tasks');
        expect(normalizeFallbackPath(null)).toBe('/tasks');
    });
});
