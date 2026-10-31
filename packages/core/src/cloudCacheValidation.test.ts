import { describe, expect, it, vi } from 'vitest';
import { applyPullBatchToCache, CLOUD_TABLES, createEmptyCloudCache } from './cloudCache';
import { createCloudPullRunner, type PullBatch } from './cloudPull';

const page = (tables: Record<string, unknown>): PullBatch => ({ next_cursor: 3, has_more: false, ...tables });
const invalid: { name: string; tables: Record<string, unknown> }[] = [
    { name: 'non-array table', tables: { tasks: { id: 'private', version: 3 } } },
    { name: 'null table', tables: { habits: null } },
    { name: 'undefined table', tables: { habits: undefined } },
    ...[null, 'private', [], 4].map((row) => ({ name: `non-record row ${JSON.stringify(row)}`, tables: { tasks: [row] } })),
    ...[undefined, '', 12].map((id) => ({ name: `invalid key ${id}`, tables: { tasks: [{ id, version: 3 }] } })),
    ...[undefined, null, '3', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]
        .map((version) => ({ name: `invalid version ${version}`, tables: { tasks: [{ id: 'private', version }] } })),
    { name: 'incomplete compound key', tables: { habit_logs: [{ habit_id: 'h', version: 3 }] } },
    { name: 'empty date key', tables: { rest_days: [{ date: '', version: 3 }] } },
    { name: 'missing owner key', tables: { characters: [{ version: 3 }] } },
];

describe('cloud cache incoming row boundary', () => {
    it.each(invalid)('rejects $name without mutating cache or acknowledging the page', async ({ tables }) => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), page({ tasks: [{ id: 'kept', version: 2 }] }));
        const before = JSON.stringify(cache); let cursor = 2;
        const writeCursor = vi.fn(async (value: number) => { cursor = value; });
        const apply = vi.fn((batch: PullBatch) => { applyPullBatchToCache(cache, batch); });
        const fetchBatch = vi.fn().mockResolvedValueOnce(page({ tasks: [{ id: 'new', version: 3 }], ...tables }))
            .mockResolvedValue(page({ tasks: [{ id: 'new', version: 3 }] }));
        const runner = createCloudPullRunner({ readCursor: async () => cursor, fetchBatch, applyBatch: apply, writeCursor });
        await expect(runner.flush()).rejects.toThrow(/^cloud pull rows invalid$/);
        expect(cursor).toBe(2); expect(writeCursor).not.toHaveBeenCalled(); expect(JSON.stringify(cache)).toBe(before);
        await runner.flush(); expect(fetchBatch).toHaveBeenLastCalledWith(2, 200); expect(cursor).toBe(3);
    });

    it.each(CLOUD_TABLES)('rejects malformed arrays for %s while preserving all sections', (table) => {
        const cache = createEmptyCloudCache();
        expect(() => applyPullBatchToCache(cache, page({ [table]: { private: 'not an array' } })))
            .toThrow(/^cloud pull rows invalid$/);
        expect(cache).toEqual(createEmptyCloudCache());
    });

    it('does not invoke accessors or accept inherited identity/version fields', () => {
        const getter = vi.fn(() => { throw new Error('private diagnostic'); });
        const keyed = { version: 3 }; Object.defineProperty(keyed, 'id', { get: getter });
        const versioned = { id: 't' }; Object.defineProperty(versioned, 'version', { get: getter });
        const table = { next_cursor: 3, has_more: false }; Object.defineProperty(table, 'tasks', { get: getter });
        for (const batch of [page({ tasks: [keyed] }), page({ tasks: [versioned] }),
            page({ tasks: [Object.create({ id: 't', version: 3 })] }), table]) {
            expect(() => applyPullBatchToCache(createEmptyCloudCache(), batch)).toThrow(/^cloud pull rows invalid$/);
        }
        expect(getter).not.toHaveBeenCalled();
    });

    it('retains every valid key, including own __proto__/constructor keys, without changing map prototypes', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), page({ tasks: [
            { id: '__proto__', version: 2, name: 'one' }, { id: 'constructor', version: 3, name: 'two' },
        ] }));
        expect(Object.keys(cache.tasks)).toEqual(['__proto__', 'constructor']);
        expect(Object.getPrototypeOf(cache.tasks)).toBe(Object.prototype);
        expect(JSON.parse(JSON.stringify(cache.tasks))['__proto__']).toMatchObject({ name: 'one' });
    });

    it('keeps tombstones, equal versions, older-row rejection, omitted/empty tables and unknown future fields', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), page({ tasks: [{ id: 't', version: 3, name: 'kept' }] }));
        const next = applyPullBatchToCache(cache, page({ tasks: [{ id: 't', version: 2, name: 'old' }], habits: [], future: null }));
        expect(next.tasks.t.name).toBe('kept');
        const removed = applyPullBatchToCache(next, page({ tasks: [{ id: 't', version: 3, deleted_at: '2026-10-31' }],
            habit_logs: [{ habit_id: 'h', date: '2026-10-31', version: 3 }], user_settings: [{ user_id: 'a', version: 3 }],
        }));
        expect(removed.tasks.t.deleted_at).toBe('2026-10-31');
        expect(Object.keys(removed.habit_logs)).toEqual(['h:2026-10-31']);
        expect(Object.keys(removed.user_settings)).toEqual(['a']);
    });
});
