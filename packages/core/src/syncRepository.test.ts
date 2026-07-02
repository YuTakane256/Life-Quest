import { describe, expect, it } from 'vitest';
import {
    CANONICAL_STORAGE_KEYS,
    createCanonicalSnapshotRepositories,
    createSnapshotRepository,
    SNAPSHOT_REPOSITORY_VERSION,
    type RepositoryStorage,
} from './syncRepository';
import { sanitizeCanonicalTaskSnapshot, SYNC_SNAPSHOT_VERSION } from './syncSnapshots';

class MemoryStorage implements RepositoryStorage {
    readonly values = new Map<string, string>();
    failReads = false;
    failWrites = false;
    failRemoves = false;

    getItem(key: string): string | null {
        if (this.failReads) throw new Error('read failed');
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        if (this.failWrites) throw new Error('write failed');
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        if (this.failRemoves) throw new Error('remove failed');
        this.values.delete(key);
    }
}

const NOW = new Date('2026-07-03T00:00:00.000Z');

function task(id: string, name = 'タスク') {
    return {
        id,
        name,
        dueDate: null,
        priority: 'medium',
        tags: [],
        subtasks: [],
        recurrence: 'none',
        completed: false,
        completedAt: null,
        createdAt: '2026-07-03T00:00:00.000Z',
    };
}

describe('createSnapshotRepository', () => {
    it('空ストレージからrevision 1を作成し、sanitize済みデータを読み戻す', async () => {
        const storage = new MemoryStorage();
        const repository = createSnapshotRepository({
            storage,
            storageKey: 'tasks',
            schemaVersion: SYNC_SNAPSHOT_VERSION,
            sanitize: sanitizeCanonicalTaskSnapshot,
            now: () => NOW,
        });

        expect(await repository.load()).toEqual({ status: 'empty' });
        const saved = await repository.save({ tasks: [task('t1'), task('t1', '重複')] }, null);

        expect(saved).toEqual({
            ok: true,
            value: {
                repositoryVersion: SNAPSHOT_REPOSITORY_VERSION,
                revision: 1,
                updatedAt: NOW.toISOString(),
                data: {
                    schemaVersion: SYNC_SNAPSHOT_VERSION,
                    tasks: [task('t1')],
                },
            },
        });
        expect(await repository.load()).toEqual({
            status: 'ready',
            value: saved.ok ? saved.value : null,
        });
    });

    it('一致するrevisionだけ更新でき、古いrevisionは競合になる', async () => {
        const storage = new MemoryStorage();
        const repository = createSnapshotRepository({
            storage,
            storageKey: 'tasks',
            schemaVersion: 1,
            sanitize: sanitizeCanonicalTaskSnapshot,
            now: () => NOW,
        });
        await repository.save({ tasks: [task('t1')] }, null);

        const updated = await repository.save({ tasks: [task('t2')] }, 1);
        const stale = await repository.save({ tasks: [task('stale')] }, 1);

        expect(updated.ok && updated.value.revision).toBe(2);
        expect(stale).toEqual({ ok: false, reason: 'conflict', currentRevision: 2 });
        const loaded = await repository.load();
        expect(loaded.status === 'ready' && loaded.value.data.tasks[0].id).toBe('t2');
    });

    it('同じrevisionへの並行書き込みは一方だけ成功する', async () => {
        const storage = new MemoryStorage();
        const repository = createSnapshotRepository({
            storage,
            storageKey: 'tasks',
            schemaVersion: 1,
            sanitize: sanitizeCanonicalTaskSnapshot,
        });
        await repository.save({ tasks: [] }, null);

        const results = await Promise.all([
            repository.save({ tasks: [task('first')] }, 1),
            repository.save({ tasks: [task('second')] }, 1),
        ]);

        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok)).toEqual([
            { ok: false, reason: 'conflict', currentRevision: 2 },
        ]);
    });

    it('破損データを空として上書きせず、未対応版も区別する', async () => {
        const storage = new MemoryStorage();
        const repository = createSnapshotRepository({
            storage,
            storageKey: 'tasks',
            schemaVersion: 1,
            sanitize: sanitizeCanonicalTaskSnapshot,
        });
        storage.values.set('tasks', '{broken');

        expect(await repository.load()).toEqual({ status: 'corrupt' });
        expect(await repository.save({ tasks: [] }, null)).toEqual({
            ok: false,
            reason: 'corrupt',
            currentRevision: null,
        });

        storage.values.set('tasks', '{}');
        expect(await repository.load()).toEqual({ status: 'corrupt' });

        storage.values.set('tasks', JSON.stringify({
            repositoryVersion: 2,
            revision: 1,
            updatedAt: NOW.toISOString(),
            data: { schemaVersion: 3, tasks: [] },
        }));
        expect(await repository.load()).toEqual({
            status: 'unsupported',
            repositoryVersion: 2,
            schemaVersion: 3,
        });
    });

    it('storage例外を結果として返し、removeにもrevisionを要求する', async () => {
        const storage = new MemoryStorage();
        const repository = createSnapshotRepository({
            storage,
            storageKey: 'tasks',
            schemaVersion: 1,
            sanitize: sanitizeCanonicalTaskSnapshot,
        });
        storage.failReads = true;
        expect(await repository.load()).toEqual({ status: 'storage-error' });
        storage.failReads = false;
        storage.failWrites = true;
        expect(await repository.save({ tasks: [] }, null)).toEqual({
            ok: false,
            reason: 'storage-error',
            currentRevision: null,
        });
        storage.failWrites = false;
        await repository.save({ tasks: [] }, null);

        expect(await repository.remove(null)).toEqual({
            ok: false,
            reason: 'conflict',
            currentRevision: 1,
        });
        storage.failRemoves = true;
        expect(await repository.remove(1)).toEqual({
            ok: false,
            reason: 'storage-error',
            currentRevision: 1,
        });
        storage.failRemoves = false;
        expect(await repository.remove(1)).toEqual({ ok: true, removed: true });
        expect(await repository.remove(null)).toEqual({ ok: true, removed: false });
    });

    it('不正な更新日時を保存せずinvalidを返す', async () => {
        const storage = new MemoryStorage();
        const repository = createSnapshotRepository({
            storage,
            storageKey: 'tasks',
            schemaVersion: 1,
            sanitize: sanitizeCanonicalTaskSnapshot,
            now: () => new Date(Number.NaN),
        });

        expect(await repository.save({ tasks: [] }, null)).toEqual({
            ok: false,
            reason: 'invalid',
            currentRevision: null,
        });
        expect(storage.values.size).toBe(0);
    });
});

describe('createCanonicalSnapshotRepositories', () => {
    it('各ドメインを専用キーへ保存し、同じenvelope契約で読み戻す', async () => {
        const storage = new MemoryStorage();
        const repositories = createCanonicalSnapshotRepositories(storage, () => NOW);

        expect(repositories.tasks.storageKey).toBe(CANONICAL_STORAGE_KEYS.tasks);
        expect(repositories.habits.storageKey).toBe(CANONICAL_STORAGE_KEYS.habits);
        expect(repositories.game.storageKey).toBe(CANONICAL_STORAGE_KEYS.game);

        const [tasks, habits, game] = await Promise.all([
            repositories.tasks.save({ tasks: [task('t1')] }, null),
            repositories.habits.save({ habits: [], dailyRecords: [] }, null),
            repositories.game.save({ character: { totalXp: 30 } }, null),
        ]);

        expect(tasks.ok && tasks.value.data.tasks).toHaveLength(1);
        expect(habits.ok && habits.value.data.habits).toEqual([]);
        expect(game.ok && game.value.data.character.level).toBe(2);
        expect(storage.values.size).toBe(3);
    });
});
