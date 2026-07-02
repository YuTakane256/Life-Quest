import AsyncStorage from '@react-native-async-storage/async-storage';
import { TASK_LIMITS, createTask, type Task } from '@life-quest/core/tasks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { XP_CONFIG } from '@life-quest/core/progression';
import { useMobileGameStore } from './useMobileGameStore';
import { useMobileTaskStore } from './useMobileTaskStore';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

const storage = vi.mocked(AsyncStorage);

function task(id: string): Task {
    const value = createTask({ id, name: `Task ${id}`, now: '2026-07-02T00:00:00.000Z' });
    if (!value) throw new Error('Test task must be valid');
    return value;
}

describe('useMobileTaskStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useMobileTaskStore.setState({ tasks: [], hasHydrated: true });
        useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, lastLevelUp: null });
    });

    it('adds a normalized task and rejects an empty name', () => {
        expect(useMobileTaskStore.getState().addTask('   ')).toBe(false);
        expect(useMobileTaskStore.getState().addTask('  今日のタスク  ')).toBe(true);

        expect(useMobileTaskStore.getState().tasks).toHaveLength(1);
        expect(useMobileTaskStore.getState().tasks[0]).toMatchObject({
            name: '今日のタスク',
            priority: 'medium',
            completed: false,
        });
    });

    it('toggles completion and removes a task', () => {
        useMobileTaskStore.getState().addTask('完了確認');
        const id = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().toggleTask(id);
        expect(useMobileTaskStore.getState().tasks[0].completed).toBe(true);
        expect(useMobileTaskStore.getState().tasks[0].completedAt).toEqual(expect.any(String));

        useMobileTaskStore.getState().toggleTask(id);
        expect(useMobileTaskStore.getState().tasks[0]).toMatchObject({ completed: false, completedAt: null });

        useMobileTaskStore.getState().deleteTask(id);
        expect(useMobileTaskStore.getState().tasks).toEqual([]);
    });

    it('does not add tasks beyond the shared collection limit', () => {
        const tasks = Array.from({ length: TASK_LIMITS.maxTasks }, (_, index) => task(String(index)));
        useMobileTaskStore.setState({ tasks });

        expect(useMobileTaskStore.getState().addTask('上限超過')).toBe(false);
        expect(useMobileTaskStore.getState().tasks).toHaveLength(TASK_LIMITS.maxTasks);
    });

    it('persists tasks without transient hydration state', async () => {
        useMobileTaskStore.getState().addTask('保存対象');

        await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
        const [, serialized] = storage.setItem.mock.calls.at(-1) ?? [];
        expect(serialized).toEqual(expect.any(String));
        const envelope = JSON.parse(serialized as string) as { state: Record<string, unknown> };
        expect(envelope.state.tasks).toHaveLength(1);
        expect(envelope.state).not.toHaveProperty('hasHydrated');
    });

    it('addTask は指定した優先度で作成し、省略時は medium にする', () => {
        useMobileTaskStore.getState().addTask('高優先タスク', 'high');
        useMobileTaskStore.getState().addTask('既定タスク');

        expect(useMobileTaskStore.getState().tasks[0].priority).toBe('high');
        expect(useMobileTaskStore.getState().tasks[1].priority).toBe('medium');
    });

    describe('ゲーム報酬連携', () => {
        it('タスク完了で優先度に応じたXPとガチャカウントが付与される', () => {
            useMobileTaskStore.getState().addTask('報酬テスト');
            const id = useMobileTaskStore.getState().tasks[0].id;

            useMobileTaskStore.getState().toggleTask(id);

            const game = useMobileGameStore.getState();
            expect(game.character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);
            expect(game.gachaCount).toBe(1);
            expect(game.rewardLedger.rewardedTaskIds).toEqual([id]);
        });

        it('完了取り消し→再完了しても報酬は再付与されない', () => {
            useMobileTaskStore.getState().addTask('往復テスト');
            const id = useMobileTaskStore.getState().tasks[0].id;

            useMobileTaskStore.getState().toggleTask(id); // 完了
            useMobileTaskStore.getState().toggleTask(id); // 取り消し
            useMobileTaskStore.getState().toggleTask(id); // 再完了

            const game = useMobileGameStore.getState();
            expect(game.character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);
            expect(game.gachaCount).toBe(1);
        });

        it('選択した優先度に応じたXPが付与される', () => {
            useMobileTaskStore.getState().addTask('高優先', 'high');
            const id = useMobileTaskStore.getState().tasks[0].id;

            useMobileTaskStore.getState().toggleTask(id);

            expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.high);
        });

        it('完了→未完了への遷移では報酬が付与されない', () => {
            useMobileTaskStore.getState().addTask('遷移テスト');
            const id = useMobileTaskStore.getState().tasks[0].id;
            useMobileTaskStore.getState().toggleTask(id); // 完了

            const xpAfterComplete = useMobileGameStore.getState().character.totalXp;
            useMobileTaskStore.getState().toggleTask(id); // 取り消し
            expect(useMobileGameStore.getState().character.totalXp).toBe(xpAfterComplete);
        });
    });
});
