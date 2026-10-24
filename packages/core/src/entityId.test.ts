import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEntityId } from './entityId';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('database-compatible UUID generation', () => {
    it('uses the runtime UUID implementation when available', () => {
        const expected = '12345678-1234-4123-8123-123456789012';
        vi.stubGlobal('crypto', { randomUUID: () => expected });
        expect(createEntityId()).toBe(expected);
    });
    it('formats random bytes as a version/variant-correct UUID without randomUUID', () => {
        vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.set(Array.from({ length: 16 }, (_, index) => index)); return bytes; } });
        expect(createEntityId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    });
    it.each([undefined, {}, { randomUUID: () => { throw new Error('unavailable'); }, getRandomValues: () => { throw new Error('unavailable'); } }])('keeps the fallback UUID-compatible with frozen time and random sources', (cryptoApi) => {
        vi.stubGlobal('crypto', cryptoApi);
        vi.spyOn(Date, 'now').mockReturnValue(1792850000000);
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const ids = Array.from({ length: 100 }, createEntityId);
        expect(ids.every((id) => uuid.test(id))).toBe(true);
        expect(new Set(ids).size).toBe(100);
    });
    it('retains runtime uniqueness even if both random APIs throw', () => {
        vi.stubGlobal('crypto', undefined);
        vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('unavailable'); });
        const ids = Array.from({ length: 100 }, createEntityId);
        expect(ids.every((id) => uuid.test(id))).toBe(true);
        expect(new Set(ids).size).toBe(100);
    });
});
