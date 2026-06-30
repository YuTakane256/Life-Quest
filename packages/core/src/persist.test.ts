import { describe, expect, it } from 'vitest';
import {
    createPersistStorageEnvelope,
    createSafePersistMerge,
    isPersistedStateRecord,
    isPersistStorageEnvelope,
    parsePersistStorageEnvelope,
    readPersistedStateRecord,
    readPersistStorageEnvelope,
    serializePersistStorageEnvelope,
} from './persist';

describe('shared persist helpers', () => {
    it('reads only plain object state records', () => {
        expect(isPersistedStateRecord({ mode: 'dark' })).toBe(true);
        expect(isPersistedStateRecord(['dark'])).toBe(false);
        expect(isPersistedStateRecord(null)).toBe(false);
        expect(readPersistedStateRecord({ mode: 'dark' })).toEqual({ mode: 'dark' });
        expect(readPersistedStateRecord(['dark'])).toEqual({});
    });

    it('normalizes Zustand-style storage envelopes', () => {
        expect(isPersistStorageEnvelope({ state: { mode: 'dark' }, version: 1 })).toBe(true);
        expect(isPersistStorageEnvelope({ state: { mode: 'dark' } })).toBe(true);
        expect(isPersistStorageEnvelope({ state: ['dark'], version: 1 })).toBe(false);
        expect(isPersistStorageEnvelope({ mode: 'dark', version: 1 })).toBe(false);

        expect(readPersistStorageEnvelope({ state: { mode: 'dark' }, version: 1 })).toEqual({
            state: { mode: 'dark' },
            version: 1,
        });
        expect(readPersistStorageEnvelope({ state: { mode: 'dark' } })).toEqual({
            state: { mode: 'dark' },
            version: null,
        });
        expect(readPersistStorageEnvelope({ state: ['dark'], version: 1 })).toEqual({
            state: {},
            version: null,
        });
    });

    it('parses and serializes storage envelopes without throwing on malformed input', () => {
        expect(parsePersistStorageEnvelope('{"state":{"mode":"light"},"version":1}')).toEqual({
            state: { mode: 'light' },
            version: 1,
        });
        expect(parsePersistStorageEnvelope('{')).toBeNull();
        expect(serializePersistStorageEnvelope({ mode: 'light' }, 1)).toBe(
            '{"state":{"mode":"light"},"version":1}',
        );
        expect(createPersistStorageEnvelope(['broken'], Number.NaN)).toEqual({ state: {} });
    });

    it('merges sanitized values while preserving actions and blocking pollution keys', () => {
        const setMode = () => undefined;
        const malicious = JSON.parse(
            '{"mode":"light","__proto__":{"polluted":true},"prototype":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
        ) as Record<string, unknown>;
        const merge = createSafePersistMerge<{ mode: string; setMode: () => void }>((persisted) => ({
            ...persisted,
            setMode: null as unknown as () => void,
        }));

        const merged = merge(malicious, { mode: 'dark', setMode });

        expect(merged).toEqual({ mode: 'light', setMode });
        expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(merged, 'prototype')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(merged, 'constructor')).toBe(false);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
});
