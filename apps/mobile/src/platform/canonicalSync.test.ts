import AsyncStorage from '@react-native-async-storage/async-storage';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { CANONICAL_STORAGE_KEYS } from '@life-quest/core/syncRepository';
import type { CanonicalGameSnapshot, CanonicalTaskSnapshot } from '@life-quest/core/syncSnapshots';
import { createTask, type Task } from '@life-quest/core/tasks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobileCanonicalRepositories } from './canonicalRepositories';
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

    it('旧キーを削除せず、シード経由でもデータ内容が保持される', async () => {
        const legacyGame = JSON.stringify({ state: { character: { totalXp: 30 } }, version: 1 });
        memory.set('quest-board-game', legacyGame);

        const sync = startMobileCanonicalSync();
        try {
            await sync.ready;

            // ブリッジは旧キーをremoveItemしない。
            // （シードでストアが更新されると、ストア自身のpersistが旧キーを
            //   正規化された同内容で再保存する — それは通常のストア動作）
            expect(storage.removeItem).not.toHaveBeenCalled();
            const persisted = JSON.parse(memory.get('quest-board-game')!) as {
                state: { character: { totalXp: number } };
            };
            expect(persisted.state.character.totalXp).toBe(30);
            expect(useMobileGameStore.getState().character.totalXp).toBe(30);
        } finally {
            sync.stop();
        }
    });

    describe('起動時シード（canonical読み取り）', () => {
        it('未確認のcanonicalがあればhydration後にストアをシードし、台帳はunionになる', async () => {
            // 別端末由来を模した canonical を直接用意する
            const repositories = createMobileCanonicalRepositories();
            await repositories.game.save({
                character: { name: '別端末の勇者', avatar: 'male', totalXp: 30 },
                equipment: [],
                chestQueue: [],
                gachaCount: 9,
                rewardLedger: { rewardedTaskIds: ['remote-task'], rewardedSubtaskIds: [], habitBonusDates: [] },
            }, null);

            // ローカルの台帳にはremoteに無い証跡がある（クラッシュ窓相当）
            useMobileGameStore.setState({
                rewardLedger: { rewardedTaskIds: ['local-task'], rewardedSubtaskIds: [], habitBonusDates: [] },
            });

            const sync = startMobileCanonicalSync();
            try {
                await sync.ready;

                const game = useMobileGameStore.getState();
                expect(game.character.name).toBe('別端末の勇者');
                expect(game.gachaCount).toBe(9);
                // 台帳はcanonicalとローカルのunion（証跡は縮めない）
                expect(game.rewardLedger.rewardedTaskIds).toEqual(
                    expect.arrayContaining(['remote-task', 'local-task']),
                );
            } finally {
                sync.stop();
            }
        });

        it('確認済みrevisionのままなら（クラッシュ窓）シードせず、write-backで追い付かせる', async () => {
            // 1回目の起動: canonical作成 + カーソル記録
            useMobileTaskStore.setState({ tasks: [task('t1')] });
            const first = startMobileCanonicalSync();
            await first.ready;
            first.stop();

            // ローカルだけ進んだ状況（canonical書き込み失敗を模擬）
            useMobileTaskStore.setState({ tasks: [task('t1'), task('t2-local')] });

            const second = startMobileCanonicalSync();
            try {
                await second.ready;

                expect(useMobileTaskStore.getState().tasks.map((item) => item.id)).toEqual(['t1', 't2-local']);
                const canonical = readData<CanonicalTaskSnapshot>(CANONICAL_STORAGE_KEYS.tasks);
                expect(canonical.tasks.map((item) => item.id)).toEqual(['t1', 't2-local']);
            } finally {
                second.stop();
            }
        });

        it('hydration前はシードされず、hydration完了後にシードされる', async () => {
            const repositories = createMobileCanonicalRepositories();
            await repositories.tasks.save({ tasks: [task('from-canonical')] }, null);
            resetStores({ hydrated: false });

            const sync = startMobileCanonicalSync();
            try {
                await sync.ready;
                expect(useMobileTaskStore.getState().tasks).toEqual([]); // 未hydrationでは触らない

                useMobileTaskStore.setState({ hasHydrated: true });
                await sync.flush();

                expect(useMobileTaskStore.getState().tasks.map((item) => item.id)).toEqual(['from-canonical']);
            } finally {
                sync.stop();
            }
        });
    });
});
