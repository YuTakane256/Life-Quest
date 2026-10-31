import { describe, expect, it, vi } from 'vitest';
import { applyPullBatchToCache, cloudCacheKey, createEmptyCloudCache, loadCloudCache, persistCloudCache } from './cloudCache';

const invalid: { name: string; table: unknown }[] = [
    { name: 'null map', table: null }, { name: 'array map', table: [] },
    { name: 'primitive map', table: 'private-cache' },
    ...[null, [], 'private', { id: 'bad' }, { id: 'bad', version: '8' },
        { id: 'bad', version: 0 }, { id: 'bad', version: 1.5 }, { id: 'bad', version: Number.MAX_SAFE_INTEGER + 1 },
        { id: '', version: 8 }, { id: 'different-key', version: 8 }]
        .map((row) => ({ name: `bad row ${JSON.stringify(row)}`, table: { bad: row } })),
];
function memory() {
    const values = new Map<string, string>();
    return { values, getItem: vi.fn(async (key: string) => values.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }), removeItem: vi.fn() };
}

describe('persisted cloud cache row boundary', () => {
    it.each(invalid)('does not partially restore a section with $name or mutate stored evidence', async ({ table }) => {
        const storage = memory();
        storage.values.set(cloudCacheKey('a', 'tasks'), JSON.stringify({ tasks: { kept: { id: 'kept', version: 2 } }, subtasks: table }));
        storage.values.set(cloudCacheKey('a', 'habits'), JSON.stringify({ habits: { h: { id: 'h', version: 2 } } }));
        const before = [...storage.values.entries()];
        const loaded = await loadCloudCache(storage, 'a');
        expect(loaded.tasks).toEqual({}); expect(loaded.subtasks).toEqual({}); expect(Object.keys(loaded.habits)).toEqual(['h']);
        expect([...storage.values.entries()]).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
        expect(storage.getItem.mock.calls.map(([key]) => key)).toEqual(['tasks', 'habits', 'game', 'profile'].map((s) => `life-quest:cloud:a:cache:${s}:v1`));
    });

    it.each([null, [], 'private', 8, false])('rejects a non-record section root %j and keeps unrelated sections', async (root) => {
        const storage = memory(); storage.values.set(cloudCacheKey('a', 'tasks'), JSON.stringify(root));
        storage.values.set(cloudCacheKey('a', 'profile'), JSON.stringify({ profiles: { a: { user_id: 'a', version: 1 } } }));
        const loaded = await loadCloudCache(storage, 'a');
        expect(loaded.tasks).toEqual({}); expect(Object.keys(loaded.profiles)).toEqual(['a']);
        expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
    });

    it('keeps valid tombstones, composite keys, omitted tables, future fields and special own keys through a round trip', async () => {
        const storage = memory();
        const cache = applyPullBatchToCache(createEmptyCloudCache(), { next_cursor: 9, has_more: false,
            tasks: [{ id: '__proto__', version: 2, deleted_at: '2026-10-31' }, { id: 'constructor', version: 3 }],
            habit_logs: [{ habit_id: 'h', date: '2026-10-31', version: 4 }],
            characters: [{ user_id: 'a', version: 1 }], user_settings: [{ user_id: 'a', version: 2 }],
        });
        await persistCloudCache(storage, 'a', cache); storage.setItem.mockClear();
        const loaded = await loadCloudCache(storage, 'a');
        expect(loaded).toEqual(cache); expect(Object.getPrototypeOf(loaded.tasks)).toBe(Object.prototype);
        expect(Object.keys(loaded.tasks)).toEqual(['__proto__', 'constructor']); expect(storage.setItem).not.toHaveBeenCalled();
        storage.values.set(cloudCacheKey('a', 'tasks'), JSON.stringify({ tasks: {}, future: { private: 'unknown' } }));
        expect((await loadCloudCache(storage, 'a')).subtasks).toEqual({});
    });

    it('can require a trustworthy full restore for ownership decisions instead of hiding a discarded section', async () => {
        const storage = memory();
        storage.values.set(cloudCacheKey('a', 'tasks'), JSON.stringify({ tasks: { t: { id: 't', version: 1 } }, subtasks: { broken: null } }));
        const before = [...storage.values.entries()];
        await expect(loadCloudCache(storage, 'a', { rejectInvalidSections: true })).rejects.toThrow(/^cloud cache section invalid$/);
        expect([...storage.values.entries()]).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
        storage.values.set(cloudCacheKey('a', 'tasks'), JSON.stringify({ tasks: { t: { id: 't', version: 1 } } }));
        expect(Object.keys((await loadCloudCache(storage, 'a', { rejectInvalidSections: true })).tasks)).toEqual(['t']);
    });

    it('does not convert a storage read failure into silent corruption recovery', async () => {
        const storage = memory(); const failure = new Error('storage unavailable');
        storage.getItem.mockRejectedValueOnce(failure);
        await expect(loadCloudCache(storage, 'a')).rejects.toBe(failure);
        expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
    });

    it('rejects a PK mismatch even for composite and owner-keyed tables', async () => {
        for (const [section, table, row] of [
            ['habits', 'habit_logs', { habit_id: 'h', date: '2026-10-31', version: 2 }],
            ['game', 'characters', { user_id: 'a', version: 2 }],
            ['habits', 'rest_days', { date: '2026-10-31', version: 2 }],
        ] as const) {
            const storage = memory(); storage.values.set(cloudCacheKey('a', section), JSON.stringify({ [table]: { wrong: row } }));
            expect((await loadCloudCache(storage, 'a'))[table]).toEqual({});
        }
    });
});
