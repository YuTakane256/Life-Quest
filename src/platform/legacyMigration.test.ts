import { describe, expect, it } from 'vitest';
import { CANONICAL_STORAGE_KEYS, type RepositoryStorage } from '@life-quest/core/syncRepository';
import { LEGACY_STORAGE_KEYS } from '@life-quest/core/legacyMigration';
import { migrateWebLegacyData } from './legacyMigration';

function createMemoryStorage(initial: Record<string, string>) {
    const map = new Map(Object.entries(initial));
    const storage: RepositoryStorage = {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => { map.set(key, value); },
        removeItem: (key) => { map.delete(key); },
    };
    return { map, storage };
}

describe('migrateWebLegacyData', () => {
    it('注入したWeb互換storageの旧キーをcanonicalへ移行し、旧キーを変更しない', async () => {
        const legacyTasks = JSON.stringify({
            state: {
                tasks: [{
                    id: 't1', name: '移行対象', dueDate: null, priority: 'high', tags: [],
                    subtasks: [], recurrence: 'none', completed: true,
                    completedAt: '2026-07-01T00:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z',
                }],
            },
            version: 3,
        });
        const { map, storage } = createMemoryStorage({ [LEGACY_STORAGE_KEYS.tasks]: legacyTasks });

        const report = await migrateWebLegacyData(storage);

        expect(report.ok).toBe(true);
        expect(report.sections.tasks.status).toBe('migrated');
        expect(map.has(CANONICAL_STORAGE_KEYS.tasks)).toBe(true);
        expect(map.get(LEGACY_STORAGE_KEYS.tasks)).toBe(legacyTasks);
    });

    it('2回目の実行はskipped-existingになり何も上書きしない', async () => {
        const { map, storage } = createMemoryStorage({
            [LEGACY_STORAGE_KEYS.habits]: JSON.stringify({
                state: { habits: [{ id: 'h1', name: '運動' }], dailyRecords: [] },
                version: 2,
            }),
        });

        await migrateWebLegacyData(storage);
        const canonicalBefore = map.get(CANONICAL_STORAGE_KEYS.habits);
        const second = await migrateWebLegacyData(storage);

        expect(second.sections.habits.status).toBe('skipped-existing');
        expect(map.get(CANONICAL_STORAGE_KEYS.habits)).toBe(canonicalBefore);
    });
});
