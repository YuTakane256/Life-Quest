import AsyncStorage from '@react-native-async-storage/async-storage';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { createHabit } from '@life-quest/core/habits';
import { XP_CONFIG } from '@life-quest/core/progression';
import { createTask, type Task } from '@life-quest/core/tasks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileRewards, startRewardSync } from './rewardSync';
import { useMobileGameStore } from './useMobileGameStore';
import { useMobileHabitStore } from './useMobileHabitStore';
import { useMobileTaskStore } from './useMobileTaskStore';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

const storage = vi.mocked(AsyncStorage);
const TODAY = '2026-07-02';

function completedTask(id: string, priority: Task['priority'] = 'medium'): Task {
    const task = createTask({ id, name: `Task ${id}`, priority, now: '2026-07-02T00:00:00.000Z' });
    if (!task) throw new Error('Test task must be valid');
    return { ...task, completed: true, completedAt: '2026-07-02T01:00:00.000Z' };
}

function resetAllStores({ hydrated = true } = {}) {
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: hydrated, lastLevelUp: null });
    useMobileTaskStore.setState({ tasks: [], hasHydrated: hydrated });
    useMobileHabitStore.setState({
        habits: [],
        records: [],
        rewardEligibleDates: [],
        hasHydrated: hydrated,
    });
}

describe('reconcileRewards（再照合による報酬回復）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetAllStores();
    });

    it('完了済みタスクが台帳に無ければ付与する（ゲームストア保存失敗からの回復）', () => {
        // 再起動後の状態: タスクは完了として復元されたが、台帳は空（保存失敗）
        useMobileTaskStore.setState({ tasks: [completedTask('t1', 'high')] });

        reconcileRewards(TODAY);

        const game = useMobileGameStore.getState();
        expect(game.character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.high);
        expect(game.rewardLedger.rewardedTaskIds).toEqual(['t1']);
    });

    it('何度実行しても二重付与しない（冪等性）', () => {
        useMobileTaskStore.setState({ tasks: [completedTask('t1')] });

        reconcileRewards(TODAY);
        reconcileRewards(TODAY);
        reconcileRewards(TODAY);

        expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);
        expect(useMobileGameStore.getState().gachaCount).toBe(1);
    });

    it('台帳に記録済みのタスクには付与しない（通常経路との重複イベント）', () => {
        // 通常経路（toggle時）で付与済み
        useMobileTaskStore.setState({ tasks: [] });
        useMobileGameStore.getState().grantTaskCompletionReward('t1', 'medium');
        const xpAfterGrant = useMobileGameStore.getState().character.totalXp;

        // 再起動相当: 同じタスクが完了状態で復元され、再照合が走る
        useMobileTaskStore.setState({ tasks: [completedTask('t1')] });
        reconcileRewards(TODAY);

        expect(useMobileGameStore.getState().character.totalXp).toBe(xpAfterGrant);
        expect(useMobileGameStore.getState().gachaCount).toBe(1);
    });

    it('未完了タスクには付与しない', () => {
        const task = { ...completedTask('t1'), completed: false, completedAt: null };
        useMobileTaskStore.setState({ tasks: [task] });

        reconcileRewards(TODAY);

        expect(useMobileGameStore.getState().character.totalXp).toBe(0);
    });

    it('今日の習慣全達成が台帳に無ければボーナスを付与する', () => {
        const habit = createHabit('h1', '運動', 'general', '2026-07-01T00:00:00.000Z');
        if (!habit) throw new Error('habit');
        useMobileHabitStore.setState({
            habits: [habit],
            records: [{ habitId: 'h1', date: TODAY, completed: true, memo: '' }],
        });

        reconcileRewards(TODAY);
        reconcileRewards(TODAY); // 冪等

        expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS);
        expect(useMobileGameStore.getState().rewardLedger.habitBonusDates).toEqual([TODAY]);
    });

    it('日付をまたいでも永続化された習慣報酬の受給資格を回収する', () => {
        const previousDate = '2026-07-01';
        useMobileHabitStore.setState({ rewardEligibleDates: [previousDate] });

        reconcileRewards(TODAY);
        reconcileRewards('2026-07-03');

        expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS);
        expect(useMobileGameStore.getState().rewardLedger.habitBonusDates).toEqual([previousDate]);
    });

    it('ゲームストアがhydration前なら何もしない', () => {
        useMobileGameStore.setState({ hasHydrated: false });
        useMobileTaskStore.setState({ tasks: [completedTask('t1')] });

        reconcileRewards(TODAY);

        expect(useMobileGameStore.getState().character.totalXp).toBe(0);
        expect(useMobileGameStore.getState().rewardLedger.rewardedTaskIds).toEqual([]);
    });

    it('タスクストアがhydration前ならタスク報酬を照合しない（未復元の空リストを完了扱いしない）', () => {
        useMobileTaskStore.setState({ tasks: [], hasHydrated: false });

        expect(() => reconcileRewards(TODAY)).not.toThrow();
        expect(useMobileGameStore.getState().character.totalXp).toBe(0);
    });
});

describe('hydration順序の競合', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetAllStores({ hydrated: false });
    });

    it('ゲームストアhydration前のtoggle報酬は適用されず、状態も変化しない', () => {
        useMobileTaskStore.setState({ hasHydrated: true });
        useMobileTaskStore.getState().addTask('先行操作');
        const id = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().toggleTask(id);

        // タスクは完了したが、報酬はまだ付与されない（rehydration mergeでの消失・重複を防ぐ）
        expect(useMobileTaskStore.getState().tasks[0].completed).toBe(true);
        const game = useMobileGameStore.getState();
        expect(game.character.totalXp).toBe(0);
        expect(game.rewardLedger.rewardedTaskIds).toEqual([]);
    });

    it('hydration完了イベントで再照合が走り、先行toggleの報酬が1回だけ付与される', () => {
        const stop = startRewardSync(() => TODAY);
        try {
            // 1. タスクストアだけ先にhydration完了
            useMobileTaskStore.setState({ hasHydrated: true });
            useMobileTaskStore.getState().addTask('先行操作');
            const id = useMobileTaskStore.getState().tasks[0].id;
            useMobileTaskStore.getState().toggleTask(id); // ゲームストア未hydrationなので報酬は保留

            expect(useMobileGameStore.getState().character.totalXp).toBe(0);

            // 2. ゲームストアのhydrationが後から完了（購読が再照合を発火）
            useMobileGameStore.getState().setHasHydrated(true);

            const game = useMobileGameStore.getState();
            expect(game.character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);
            expect(game.rewardLedger.rewardedTaskIds).toEqual([id]);

            // 3. 以降の再照合・再toggleでも増えない
            reconcileRewards(TODAY);
            useMobileTaskStore.getState().toggleTask(id);
            useMobileTaskStore.getState().toggleTask(id);
            expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);
        } finally {
            stop();
        }
    });

    it('逆順（ゲーム→タスクの順にhydration）でも1回だけ付与される', () => {
        const stop = startRewardSync(() => TODAY);
        try {
            useMobileGameStore.getState().setHasHydrated(true);
            expect(useMobileGameStore.getState().character.totalXp).toBe(0);

            // タスクストアが後からhydration完了（完了済みタスクを含む）
            useMobileTaskStore.setState({ tasks: [completedTask('t1', 'low')], hasHydrated: true });

            expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.low);
            expect(useMobileGameStore.getState().gachaCount).toBe(1);
        } finally {
            stop();
        }
    });

    it('habitストアのhydration完了でも今日の全達成ボーナスが照合される', () => {
        const stop = startRewardSync(() => TODAY);
        try {
            useMobileGameStore.getState().setHasHydrated(true);

            const habit = createHabit('h1', '運動', 'general', '2026-07-01T00:00:00.000Z');
            if (!habit) throw new Error('habit');
            useMobileHabitStore.setState({
                habits: [habit],
                records: [{ habitId: 'h1', date: TODAY, completed: true, memo: '' }],
                rewardEligibleDates: [TODAY],
                hasHydrated: true,
            });

            expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS);
        } finally {
            stop();
        }
    });
});

describe('保存失敗と再起動のシミュレーション', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetAllStores();
    });

    it('ゲームストアの保存が失敗してもクラッシュせず、再起動相当の復元後に再照合で回復する', async () => {
        storage.setItem.mockRejectedValue(new Error('disk full'));

        // 通常経路で付与（メモリ上は成功、永続化は失敗）
        useMobileTaskStore.setState({ tasks: [completedTask('t1', 'high')] });
        useMobileGameStore.getState().grantTaskCompletionReward('t1', 'high');
        expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.high);

        // 再起動相当: ゲームストアは保存失敗前の状態（空）から復元される
        const persistOptions = useMobileGameStore.persist.getOptions();
        const merged = persistOptions.merge?.(
            { ...createInitialGameStateSnapshot() }, // 台帳もXPも無い古い保存データ
            useMobileGameStore.getState(),
        );
        useMobileGameStore.setState({
            ...(merged as Parameters<typeof useMobileGameStore.setState>[0]),
            hasHydrated: true,
        });
        expect(useMobileGameStore.getState().character.totalXp).toBe(0);

        // タスクストア側は完了が保存されていた → 再照合で報酬が復元される
        reconcileRewards(TODAY);
        expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.high);
        expect(useMobileGameStore.getState().rewardLedger.rewardedTaskIds).toEqual(['t1']);
    });

    it('両ストアが正常に保存された再起動では二重付与されない', () => {
        // 通常経路で付与
        useMobileTaskStore.setState({ tasks: [completedTask('t1')] });
        useMobileGameStore.getState().grantTaskCompletionReward('t1', 'medium');

        // 再起動相当: 台帳込みの保存データから復元
        const persistOptions = useMobileGameStore.persist.getOptions();
        const persisted = persistOptions.partialize?.(useMobileGameStore.getState());
        const merged = persistOptions.merge?.(persisted, useMobileGameStore.getState());
        useMobileGameStore.setState({
            ...(merged as Parameters<typeof useMobileGameStore.setState>[0]),
            hasHydrated: true,
        });

        reconcileRewards(TODAY);
        expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);
        expect(useMobileGameStore.getState().gachaCount).toBe(1);
    });
});
