import { describe, expect, it } from 'vitest';
import { CANONICAL_STORAGE_KEYS, type RepositoryStorage } from '@life-quest/core/syncRepository';
import { createWebCanonicalRepositories } from './canonicalRepositories';

describe('createWebCanonicalRepositories', () => {
    it('注入したWeb互換storageへcanonical envelopeを書き込む', async () => {
        const values = new Map<string, string>();
        const storage: RepositoryStorage = {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => { values.set(key, value); },
            removeItem: (key) => { values.delete(key); },
        };
        const repositories = createWebCanonicalRepositories(storage);

        const result = await repositories.tasks.save({ tasks: [] }, null);

        expect(result.ok).toBe(true);
        expect(values.has(CANONICAL_STORAGE_KEYS.tasks)).toBe(true);
        expect(values.has('quest-board-tasks')).toBe(false);
    });
});
