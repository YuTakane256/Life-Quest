import { beforeEach, describe, expect, it } from 'vitest';
import {
    CANONICAL_STORAGE_KEYS,
    type RepositoryStorage,
} from '@life-quest/core/syncRepository';
import { LEGACY_STORAGE_KEYS } from '@life-quest/core/legacyMigration';
import type { CanonicalGameSnapshot, CanonicalTaskSnapshot } from '@life-quest/core/syncSnapshots';
import { startWebCanonicalSync } from './canonicalSync';
import { useTaskStore } from '../stores/useTaskStore';
import { useTitleStore } from '../stores/useTitleStore';

function createMemoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    const storage: RepositoryStorage = {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => { map.set(key, value); },
        removeItem: (key) => { map.delete(key); },
    };
    return { map, storage };
}

function readData<T>(map: Map<string, string>, key: string): T {
    const raw = map.get(key);
    if (!raw) throw new Error(`canonical not written: ${key}`);
    return (JSON.parse(raw) as { data: T }).data;
}

function task(id: string, completed = false) {
    return {
        id, name: `Task ${id}`, dueDate: null, priority: 'medium' as const, tags: [],
        subtasks: [], recurrence: 'none' as const, completed,
        completedAt: completed ? '2026-07-01T00:00:00.000Z' : null,
        createdAt: '2026-07-01T00:00:00.000Z',
    };
}

describe('startWebCanonicalSync', () => {
    beforeEach(() => {
        useTaskStore.setState({ tasks: [], pendingCompletions: [] });
        useTitleStore.setState({ activeTitle: null });
    });

    it('起動時に移行と初期同期を実行し、canonicalを作成する', async () => {
        const legacyTasks = JSON.stringify({ state: { tasks: [task('t1', true)] }, version: 3 });
        const { map, storage } = createMemoryStorage({ [LEGACY_STORAGE_KEYS.tasks]: legacyTasks });
        useTaskStore.setState({ tasks: [task('t1', true)] });

        const sync = startWebCanonicalSync(storage);
        try {
            await sync.ready;

            const tasks = readData<CanonicalTaskSnapshot>(map, CANONICAL_STORAGE_KEYS.tasks);
            expect(tasks.tasks.map((item) => item.id)).toEqual(['t1']);
            // 旧キーは不変
            expect(map.get(LEGACY_STORAGE_KEYS.tasks)).toBe(legacyTasks);
            // 移行で完了タスクが報酬証跡として台帳に入る
            const game = readData<CanonicalGameSnapshot>(map, CANONICAL_STORAGE_KEYS.game);
            expect(game.rewardLedger.rewardedTaskIds).toEqual(['t1']);
        } finally {
            sync.stop();
        }
    });

    it('ストアの変更が購読経由でcanonicalへ書き戻される', async () => {
        const { map, storage } = createMemoryStorage();
        const sync = startWebCanonicalSync(storage);
        try {
            await sync.ready;

            useTaskStore.setState({ tasks: [task('t-new')] });
            await sync.flush();

            const tasks = readData<CanonicalTaskSnapshot>(map, CANONICAL_STORAGE_KEYS.tasks);
            expect(tasks.tasks.map((item) => item.id)).toEqual(['t-new']);
        } finally {
            sync.stop();
        }
    });

    it('変更が無ければrevisionが進まない（unchanged）', async () => {
        const { map, storage } = createMemoryStorage();
        useTaskStore.setState({ tasks: [task('t1')] });
        const sync = startWebCanonicalSync(storage);
        try {
            await sync.ready;
            const before = map.get(CANONICAL_STORAGE_KEYS.tasks);

            const results = await sync.flush();

            expect(results.tasks?.status).toBe('unchanged');
            expect(map.get(CANONICAL_STORAGE_KEYS.tasks)).toBe(before);
        } finally {
            sync.stop();
        }
    });

    it('報酬台帳は単調増加し、完了タスクを削除しても証跡が残る', async () => {
        const { map, storage } = createMemoryStorage();
        useTaskStore.setState({ tasks: [task('t1', true)] });
        const sync = startWebCanonicalSync(storage);
        try {
            await sync.ready;
            let game = readData<CanonicalGameSnapshot>(map, CANONICAL_STORAGE_KEYS.game);
            expect(game.rewardLedger.rewardedTaskIds).toEqual(['t1']);

            // 完了済みタスクを削除してもcanonicalの台帳からは消えない
            useTaskStore.setState({ tasks: [] });
            await sync.flush();
            game = readData<CanonicalGameSnapshot>(map, CANONICAL_STORAGE_KEYS.game);
            expect(game.rewardLedger.rewardedTaskIds).toEqual(['t1']);
        } finally {
            sync.stop();
        }
    });

    it('称号の変更もgame canonicalへ反映される', async () => {
        const { map, storage } = createMemoryStorage();
        const sync = startWebCanonicalSync(storage);
        try {
            await sync.ready;

            useTitleStore.setState({ activeTitle: '努力の人' });
            await sync.flush();

            const game = readData<CanonicalGameSnapshot>(map, CANONICAL_STORAGE_KEYS.game);
            expect(game.activeTitle).toBe('努力の人');
        } finally {
            sync.stop();
        }
    });

    it('canonicalが破損していれば書き戻さない', async () => {
        const { map, storage } = createMemoryStorage({
            [CANONICAL_STORAGE_KEYS.tasks]: '{broken',
        });
        useTaskStore.setState({ tasks: [task('t1')] });
        const sync = startWebCanonicalSync(storage);
        try {
            await sync.ready;

            const results = await sync.flush();

            expect(results.tasks).toEqual({ status: 'skipped-unsafe', reason: 'canonical-corrupt' });
            expect(map.get(CANONICAL_STORAGE_KEYS.tasks)).toBe('{broken');
        } finally {
            sync.stop();
        }
    });

    it('stop後はストア変更を同期しない', async () => {
        const { map, storage } = createMemoryStorage();
        const sync = startWebCanonicalSync(storage);
        await sync.ready;
        sync.stop();
        const before = map.get(CANONICAL_STORAGE_KEYS.tasks);

        useTaskStore.setState({ tasks: [task('after-stop')] });
        // 購読は解除済みなので書き込みは起きない（flushを呼ばない）
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(map.get(CANONICAL_STORAGE_KEYS.tasks)).toBe(before);
    });
});
