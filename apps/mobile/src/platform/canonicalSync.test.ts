import AsyncStorage from '@react-native-async-storage/async-storage';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { CANONICAL_STORAGE_KEYS } from '@life-quest/core/syncRepository';
import type { CanonicalGameSnapshot, CanonicalTaskSnapshot } from '@life-quest/core/syncSnapshots';
import { createTask, type Task } from '@life-quest/core/tasks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startMobileCanonicalSync } from './canonicalSync';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';

const memory = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => { memory.set(key, value); }),
        removeItem: vi.fn(async (key: string) => { memory.delete(key); }),
    },
}));

const storage = vi.mocked(AsyncStorage);

function task(id: string, completed = false): Task {
    const created = createTask({ id, name: `Task ${id}`, now: '2026-07-01T00:00:00.000Z' });
    if (!created) throw new Error('invalid task');
    return { ...created, completed, completedAt: completed ? '2026-07-01T01:00:00.000Z' : null };
}

function readData<T>(key: string): T {
    const raw = memory.get(key);
    if (!raw) throw new Error(`canonical not written: ${key}`);
    return (JSON.parse(raw) as { data: T }).data;
}

function resetStores({ hydrated = true } = {}) {
    useMobileTaskStore.setState({ tasks: [], hasHydrated: hydrated });
    useMobileHabitStore.setState({ habits: [], records: [], rewardEligibleDates: [], hasHydrated: hydrated });
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: hydrated, lastLevelUp: null });
}

describe('startMobileCanonicalSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        memory.clear();
        resetStores();
    });

    it('起動時に移行と初期同期を実行し、ストアの報酬台帳がcanonicalへ届く', async () => {
        resetStores();
        useMobileTaskStore.setState({ tasks: [task('t1', true)] });
        useMobileGameStore.setState({
            rewardLedger: { rewardedTaskIds: ['t1'], rewardedSubtaskIds: [], habitBonusDates: ['2026-07-01'] },
        });

        const sync = startMobileCanonicalSync();
        try {
            await sync.ready;

            const game = readData<CanonicalGameSnapshot>(CANONICAL_STORAGE_KEYS.game);
            expect(game.rewardLedger.rewardedTaskIds).toEqual(['t1']);
            expect(game.rewardLedger.habitBonusDates).toEqual(['2026-07-01']);
            const tasks = readData<CanonicalTaskSnapshot>(CANONICAL_STORAGE_KEYS.tasks);
            expect(tasks.tasks.map((item) => item.id)).toEqual(['t1']);
        } finally {
            sync.stop();
        }
    });

    it('hydration前のセクションは同期しない（空上書き防止）', async () => {
        // ストアのpersistが書くquest-board-*と分離するため隔離ストレージを使う
        const isolated = new Map<string, string>();
        const isolatedStorage = {
            getItem: (key: string) => isolated.get(key) ?? null,
            setItem: (key: string, value: string) => { isolated.set(key, value); },
            removeItem: (key: string) => { isolated.delete(key); },
        };
        resetStores({ hydrated: false });

        const sync = startMobileCanonicalSync(isolatedStorage);
        try {
            await sync.ready;
            const results = await sync.flush();

            expect(results).toEqual({});
            expect(isolated.has(CANONICAL_STORAGE_KEYS.tasks)).toBe(false);
            expect(isolated.has(CANONICAL_STORAGE_KEYS.game)).toBe(false);
        } finally {
            sync.stop();
        }
    });

    it('hydration完了で購読が発火し、そのセクションだけ同期される', async () => {
        const isolated = new Map<string, string>();
        const isolatedStorage = {
            getItem: (key: string) => isolated.get(key) ?? null,
            setItem: (key: string, value: string) => { isolated.set(key, value); },
            removeItem: (key: string) => { isolated.delete(key); },
        };
        resetStores({ hydrated: false });
        const sync = startMobileCanonicalSync(isolatedStorage);
        try {
            await sync.ready;

            useMobileTaskStore.setState({ tasks: [task('t1')], hasHydrated: true });
            await sync.flush();

            expect(isolated.has(CANONICAL_STORAGE_KEYS.tasks)).toBe(true);
            expect(isolated.has(CANONICAL_STORAGE_KEYS.game)).toBe(false);
        } finally {
            sync.stop();
        }
    });

    it('canonicalの既存台帳とストアの台帳がマージされ重複しない', async () => {
        // 先にcanonicalへ別クライアント由来の証跡を作る
        const sync1 = startMobileCanonicalSync();
        await sync1.ready;
        useMobileGameStore.setState({
            rewardLedger: { rewardedTaskIds: ['from-web'], rewardedSubtaskIds: [], habitBonusDates: [] },
        });
        await sync1.flush();
        sync1.stop();

        // ストアがリセットされても（別端末を模擬）、canonical側の証跡は保持される
        useMobileGameStore.setState({
            rewardLedger: { rewardedTaskIds: ['local-only', 'from-web'], rewardedSubtaskIds: [], habitBonusDates: [] },
        });
        const sync2 = startMobileCanonicalSync();
        try {
            await sync2.ready;
            await sync2.flush();

            const game = readData<CanonicalGameSnapshot>(CANONICAL_STORAGE_KEYS.game);
            const fromWeb = game.rewardLedger.rewardedTaskIds.filter((id) => id === 'from-web');
            expect(fromWeb).toHaveLength(1); // 重複しない
            expect(game.rewardLedger.rewardedTaskIds).toContain('local-only');
        } finally {
            sync2.stop();
        }
    });

    it('変更が無ければrevisionが進まない', async () => {
        useMobileTaskStore.setState({ tasks: [task('t1')] });
        const sync = startMobileCanonicalSync();
        try {
            await sync.ready;
            const before = memory.get(CANONICAL_STORAGE_KEYS.tasks);

            const results = await sync.flush();

            expect(results.tasks?.status).toBe('unchanged');
            expect(memory.get(CANONICAL_STORAGE_KEYS.tasks)).toBe(before);
        } finally {
            sync.stop();
        }
    });

    it('旧キーに対してremoveItemや上書きを行わない', async () => {
        const legacyGame = JSON.stringify({ state: { character: { totalXp: 30 } }, version: 1 });
        memory.set('quest-board-game', legacyGame);

        const sync = startMobileCanonicalSync();
        try {
            await sync.ready;

            expect(storage.removeItem).not.toHaveBeenCalled();
            expect(memory.get('quest-board-game')).toBe(legacyGame);
        } finally {
            sync.stop();
        }
    });
});
