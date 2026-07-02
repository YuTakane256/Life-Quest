import { describe, expect, it, vi } from 'vitest';
import { CANONICAL_STORAGE_KEYS, type RepositoryStorage } from '@life-quest/core/syncRepository';
import { createMobileCanonicalRepositories } from './canonicalRepositories';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

describe('createMobileCanonicalRepositories', () => {
    it('注入したAsyncStorage互換storageへ同じcanonical envelopeを書き込む', async () => {
        const values = new Map<string, string>();
        const storage: RepositoryStorage = {
            getItem: async (key) => values.get(key) ?? null,
            setItem: async (key, value) => { values.set(key, value); },
            removeItem: async (key) => { values.delete(key); },
        };
        const repositories = createMobileCanonicalRepositories(storage);

        const result = await repositories.habits.save({ habits: [], records: [] }, null);

        expect(result.ok).toBe(true);
        expect(values.has(CANONICAL_STORAGE_KEYS.habits)).toBe(true);
        expect(values.has('quest-board-habits')).toBe(false);
    });
});
