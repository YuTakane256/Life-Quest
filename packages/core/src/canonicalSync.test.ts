import { describe, expect, it } from 'vitest';
import { writeCanonicalSnapshot } from './canonicalSync';
import {
    CANONICAL_STORAGE_KEYS,
    createCanonicalSnapshotRepositories,
    type RepositoryStorage,
} from './syncRepository';
import { convertLegacyTaskSnapshot } from './syncSnapshots';

function createMemoryStorage() {
    const map = new Map<string, string>();
    const storage: RepositoryStorage = {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => { map.set(key, value); },
        removeItem: (key) => { map.delete(key); },
    };
    return { map, storage };
}

function task(id: string, completed = false) {
    return {
        id, name: `Task ${id}`, dueDate: null, priority: 'medium', tags: [],
        subtasks: [], recurrence: 'none', completed,
        completedAt: completed ? '2026-07-01T00:00:00.000Z' : null,
        createdAt: '2026-07-01T00:00:00.000Z',
    };
}

describe('writeCanonicalSnapshot', () => {
    it('canonicalが空なら新規作成する', async () => {
        const { storage } = createMemoryStorage();
        const repos = createCanonicalSnapshotRepositories(storage);

        const result = await writeCanonicalSnapshot(repos.tasks, convertLegacyTaskSnapshot({ tasks: [task('t1')] }));

        expect(result).toEqual({ status: 'created', revision: 1 });
    });

    it('内容が同一なら書き込まずrevisionを維持する', async () => {
        const { map, storage } = createMemoryStorage();
        const repos = createCanonicalSnapshotRepositories(storage);
        const snapshot = convertLegacyTaskSnapshot({ tasks: [task('t1')] });

        await writeCanonicalSnapshot(repos.tasks, snapshot);
        const stored = map.get(CANONICAL_STORAGE_KEYS.tasks);
        const second = await writeCanonicalSnapshot(repos.tasks, snapshot);

        expect(second).toEqual({ status: 'unchanged', revision: 1 });
        expect(map.get(CANONICAL_STORAGE_KEYS.tasks)).toBe(stored);
    });

    it('内容が変わればrevisionを進めて更新する', async () => {
        const { storage } = createMemoryStorage();
        const repos = createCanonicalSnapshotRepositories(storage);

        await writeCanonicalSnapshot(repos.tasks, convertLegacyTaskSnapshot({ tasks: [task('t1')] }));
        const result = await writeCanonicalSnapshot(
            repos.tasks,
            convertLegacyTaskSnapshot({ tasks: [task('t1'), task('t2')] }),
        );

        expect(result).toEqual({ status: 'updated', revision: 2 });
    });

    it('canonicalが破損していれば書き戻さない', async () => {
        const { map, storage } = createMemoryStorage();
        map.set(CANONICAL_STORAGE_KEYS.tasks, '{broken');
        const repos = createCanonicalSnapshotRepositories(storage);

        const result = await writeCanonicalSnapshot(repos.tasks, convertLegacyTaskSnapshot({ tasks: [] }));

        expect(result).toEqual({ status: 'skipped-unsafe', reason: 'canonical-corrupt' });
        expect(map.get(CANONICAL_STORAGE_KEYS.tasks)).toBe('{broken');
    });

    it('未対応スキーマなら書き戻さない', async () => {
        const { map, storage } = createMemoryStorage();
        map.set(CANONICAL_STORAGE_KEYS.tasks, JSON.stringify({
            repositoryVersion: 1, revision: 1, updatedAt: '2026-07-01T00:00:00.000Z',
            data: { schemaVersion: 999 },
        }));
        const repos = createCanonicalSnapshotRepositories(storage);

        const result = await writeCanonicalSnapshot(repos.tasks, convertLegacyTaskSnapshot({ tasks: [] }));

        expect(result).toEqual({ status: 'skipped-unsafe', reason: 'canonical-unsupported' });
    });

    it('書き込み中のstorage-errorは即failedになる（再試行しない）', async () => {
        const { map, storage } = createMemoryStorage();
        const repos = createCanonicalSnapshotRepositories(storage);
        await writeCanonicalSnapshot(repos.tasks, convertLegacyTaskSnapshot({ tasks: [task('t1')] }));

        // loadの後・saveの前に割り込む書き込みを注入するstorage
        let interfered = false;
        const racy: RepositoryStorage = {
            getItem: (key) => map.get(key) ?? null,
            setItem: (key, value) => {
                if (!interfered && key === CANONICAL_STORAGE_KEYS.tasks) {
                    interfered = true;
                    // 割り込み: 別クライアントがrevision 2を書いた状態を作る
                    map.set(key, JSON.stringify({
                        repositoryVersion: 1, revision: 2, updatedAt: '2026-07-02T00:00:00.000Z',
                        data: { schemaVersion: 1, tasks: [] },
                    }));
                    throw new Error('interrupted');
                }
                map.set(key, value);
            },
            removeItem: (key) => { map.delete(key); },
        };
        const racyRepos = createCanonicalSnapshotRepositories(racy);

        const result = await writeCanonicalSnapshot(
            racyRepos.tasks,
            convertLegacyTaskSnapshot({ tasks: [task('t1'), task('t2')] }),
        );

        // storage-errorは即failed。再試行されるのはconflictのみ
        expect(result).toEqual({ status: 'failed', reason: 'storage-error' });
    });

    it('revision競合は再読込して1回だけ再試行し成功する', async () => {
        const { map, storage } = createMemoryStorage();
        const repos = createCanonicalSnapshotRepositories(storage);
        await writeCanonicalSnapshot(repos.tasks, convertLegacyTaskSnapshot({ tasks: [task('t1')] }));

        // writeCanonicalSnapshotの1回目のloadにはrevision 1を見せ、
        // save内部の再読込でrevision 2を見せることでconflictを起こす
        const staleEnvelope = map.get(CANONICAL_STORAGE_KEYS.tasks)!;
        const bumped = JSON.stringify({
            ...JSON.parse(staleEnvelope) as Record<string, unknown>,
            revision: 2,
        });
        let reads = 0;
        const racy: RepositoryStorage = {
            getItem: (key) => {
                if (key === CANONICAL_STORAGE_KEYS.tasks) {
                    reads += 1;
                    if (reads === 1) return staleEnvelope; // ブリッジのload
                    return bumped; // save内の再読込・再試行のload
                }
                return map.get(key) ?? null;
            },
            setItem: (key, value) => { map.set(key, value); },
            removeItem: (key) => { map.delete(key); },
        };
        const racyRepos = createCanonicalSnapshotRepositories(racy);

        const result = await writeCanonicalSnapshot(
            racyRepos.tasks,
            convertLegacyTaskSnapshot({ tasks: [task('t1'), task('t2')] }),
        );

        expect(result).toEqual({ status: 'updated', revision: 3 });
    });
});
