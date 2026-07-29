import AsyncStorage from '@react-native-async-storage/async-storage';
import { TASK_LIMITS, createTask, type Task } from '@life-quest/core/tasks';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { XP_CONFIG } from '@life-quest/core/progression';
import { getSubtaskRewardXp } from '@life-quest/core/tasks';
import { useMobileGameStore } from './useMobileGameStore';
import { useMobileStatsStore } from './useMobileStatsStore';
import { useMobileTaskStore } from './useMobileTaskStore';
import { isoToJstYmd } from '../utils/date';
import { clearPendingRewardOperations } from '../platform/pendingRewardOperations';
import { startRewardSync } from './rewardSync';

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
        vi.useFakeTimers();
        setGameRewardAuthorityState('anonymous');
        clearPendingRewardOperations();
        useMobileTaskStore.setState({ tasks: [], pendingCompletions: [], hasHydrated: true });
        useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, lastLevelUp: null });
        useMobileStatsStore.setState({ taskXpLog: {}, habitLog: {}, seeded: true, hasHydrated: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** 完了トグル後に5秒のUndo猶予を経過させて確定する（#512） */
    const completeAndConfirm = (id: string) => {
        useMobileTaskStore.getState().toggleTask(id);
        vi.advanceTimersByTime(5000);
    };

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

    it('JST早朝（UTC前日15時以降）に完了してもJST日付でtaskXpLogに記録される（サーバーのgetTodayJst()と一致させるため）', () => {
        // UTC 2025-03-14T20:00:00Z = JST 2025-03-15T05:00:00（早朝）
        vi.setSystemTime(new Date('2025-03-14T20:00:00Z'));
        useMobileTaskStore.getState().addTask('早朝完了タスク', 'high');
        const id = useMobileTaskStore.getState().tasks[0].id;
        completeAndConfirm(id);
        expect(useMobileStatsStore.getState().taskXpLog['2025-03-15']).toBe(XP_CONFIG.REWARD_BY_PRIORITY.high);
        expect(useMobileStatsStore.getState().taskXpLog['2025-03-14']).toBeUndefined();
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

    it('hydration完了前の追加・変更・削除を無視する', () => {
        useMobileTaskStore.setState({ tasks: [task('t1')], hasHydrated: false });

        expect(useMobileTaskStore.getState().addTask('復元中')).toBe(false);
        useMobileTaskStore.getState().toggleTask('t1');
        useMobileTaskStore.getState().deleteTask('t1');

        expect(useMobileTaskStore.getState().tasks).toEqual([task('t1')]);
        expect(useMobileGameStore.getState().character.totalXp).toBe(0);
    });

    it('addTask は指定した優先度で作成し、省略時は medium にする', () => {
        useMobileTaskStore.getState().addTask('高優先タスク', 'high');
        useMobileTaskStore.getState().addTask('既定タスク');

        expect(useMobileTaskStore.getState().tasks[0].priority).toBe('high');
        expect(useMobileTaskStore.getState().tasks[1].priority).toBe('medium');
    });

    describe('ゲーム報酬連携', () => {
        it('認証復元中の繰り返しタスクはanonymous確定後に報酬と次回分を一度だけ生成する', () => {
            setGameRewardAuthorityState('resolving');
            const stop = startRewardSync(() => '2026-07-02');
            try {
                useMobileTaskStore.getState().addTask('毎日の復元中タスク', 'medium', { recurrence: 'daily' });
                const id = useMobileTaskStore.getState().tasks[0].id;
                completeAndConfirm(id);

                expect(useMobileGameStore.getState().character.totalXp).toBe(0);
                expect(useMobileTaskStore.getState().tasks).toHaveLength(1);

                setGameRewardAuthorityState('anonymous');
                expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);
                expect(useMobileTaskStore.getState().tasks).toHaveLength(2);

                setGameRewardAuthorityState('anonymous');
                expect(useMobileTaskStore.getState().tasks).toHaveLength(2);
            } finally {
                stop();
            }
        });

        it('認証復元中の繰り返しタスクはauthenticated確定後にローカル次回分を生成しない', () => {
            setGameRewardAuthorityState('resolving');
            const stop = startRewardSync(() => '2026-07-02');
            try {
                useMobileTaskStore.getState().addTask('クラウド復元中タスク', 'medium', { recurrence: 'daily' });
                const id = useMobileTaskStore.getState().tasks[0].id;
                completeAndConfirm(id);

                setGameRewardAuthorityState('authenticated');
                expect(useMobileGameStore.getState().character.totalXp).toBe(0);
                expect(useMobileTaskStore.getState().tasks).toHaveLength(1);
            } finally {
                stop();
            }
        });

        it('タスク完了で優先度に応じたXPとガチャカウントが付与される（Undo猶予後に確定）', () => {
            useMobileTaskStore.getState().addTask('報酬テスト');
            const id = useMobileTaskStore.getState().tasks[0].id;

            completeAndConfirm(id);

            const game = useMobileGameStore.getState();
            expect(game.character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);
            expect(game.gachaCount).toBe(1);
            expect(game.rewardLedger.rewardedTaskIds).toEqual([id]);
        });

        it('完了取り消し→再完了しても報酬は再付与されない', () => {
            useMobileTaskStore.getState().addTask('往復テスト');
            const id = useMobileTaskStore.getState().tasks[0].id;

            completeAndConfirm(id);                       // 完了（確定）
            useMobileTaskStore.getState().toggleTask(id); // 取り消し
            completeAndConfirm(id);                       // 再完了（確定）

            const game = useMobileGameStore.getState();
            expect(game.character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);
            expect(game.gachaCount).toBe(1);
        });

        it('選択した優先度に応じたXPが付与される', () => {
            useMobileTaskStore.getState().addTask('高優先', 'high');
            const id = useMobileTaskStore.getState().tasks[0].id;

            completeAndConfirm(id);

            expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.high);
        });

        it('完了→未完了への遷移では報酬が付与されない', () => {
            useMobileTaskStore.getState().addTask('遷移テスト');
            const id = useMobileTaskStore.getState().tasks[0].id;
            completeAndConfirm(id); // 完了（確定）

            const xpAfterComplete = useMobileGameStore.getState().character.totalXp;
            useMobileTaskStore.getState().toggleTask(id); // 取り消し
            expect(useMobileGameStore.getState().character.totalXp).toBe(xpAfterComplete);
        });
    });

    describe('期限・タグ・繰り返し付きの作成', () => {
        it('addTask がオプションを反映する', () => {
            useMobileTaskStore.getState().addTask('詳細付き', 'high', {
                dueDate: '2026-07-10',
                tags: ['家事', '重要'],
                recurrence: 'weekly',
            });
            expect(useMobileTaskStore.getState().tasks[0]).toMatchObject({
                dueDate: '2026-07-10',
                tags: ['家事', '重要'],
                recurrence: 'weekly',
                priority: 'high',
            });
        });
    });

    describe('繰り返しタスク', () => {
        it('完了で次回分が生成され、重複しては生成されない', () => {
            useMobileTaskStore.getState().addTask('毎日の運動', 'medium', { dueDate: '2026-07-03', recurrence: 'daily' });
            const id = useMobileTaskStore.getState().tasks[0].id;

            completeAndConfirm(id);

            const tasks = useMobileTaskStore.getState().tasks;
            expect(tasks).toHaveLength(2);
            const next = tasks.find((task) => task.id !== id)!;
            expect(next).toMatchObject({ name: '毎日の運動', dueDate: '2026-07-04', recurrence: 'daily', completed: false });

            // 取り消して再完了しても同じ次回分は増えない（報酬も台帳が防止）
            useMobileTaskStore.getState().toggleTask(id);
            completeAndConfirm(id);
            expect(useMobileTaskStore.getState().tasks).toHaveLength(2);
            expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);
        });
    });

    describe('サブタスク', () => {
        it('追加すると親が未完了へ戻る', () => {
            useMobileTaskStore.getState().addTask('親タスク');
            const id = useMobileTaskStore.getState().tasks[0].id;
            useMobileTaskStore.getState().toggleTask(id); // 完了

            expect(useMobileTaskStore.getState().addSubtask(id, 'サブ1')).toBe(true);

            const task = useMobileTaskStore.getState().tasks[0];
            expect(task.completed).toBe(false);
            expect(task.subtasks).toHaveLength(1);
        });

        it('サブタスク完了で半分のXP、全完了で親の報酬も付与される', () => {
            useMobileTaskStore.getState().addTask('親タスク', 'high');
            const id = useMobileTaskStore.getState().tasks[0].id;
            useMobileTaskStore.getState().addSubtask(id, 'サブ1');
            useMobileTaskStore.getState().addSubtask(id, 'サブ2');
            const [s1, s2] = useMobileTaskStore.getState().tasks[0].subtasks;

            useMobileTaskStore.getState().toggleSubtaskComplete(id, s1.id);
            expect(useMobileGameStore.getState().character.totalXp).toBe(getSubtaskRewardXp('high'));
            expect(useMobileTaskStore.getState().tasks[0].completed).toBe(false);

            useMobileTaskStore.getState().toggleSubtaskComplete(id, s2.id);
            const task = useMobileTaskStore.getState().tasks[0];
            expect(task.completed).toBe(true);
            expect(useMobileGameStore.getState().character.totalXp).toBe(
                getSubtaskRewardXp('high') * 2 + XP_CONFIG.REWARD_BY_PRIORITY.high,
            );
        });

        it('サブタスクの完了→解除→再完了で報酬は再付与されない', () => {
            useMobileTaskStore.getState().addTask('親タスク', 'low');
            const id = useMobileTaskStore.getState().tasks[0].id;
            useMobileTaskStore.getState().addSubtask(id, 'サブ1');
            useMobileTaskStore.getState().addSubtask(id, 'サブ2');
            const s1 = useMobileTaskStore.getState().tasks[0].subtasks[0];

            useMobileTaskStore.getState().toggleSubtaskComplete(id, s1.id);
            useMobileTaskStore.getState().toggleSubtaskComplete(id, s1.id);
            useMobileTaskStore.getState().toggleSubtaskComplete(id, s1.id);

            expect(useMobileGameStore.getState().character.totalXp).toBe(getSubtaskRewardXp('low'));
        });

        it('未完了サブタスクの削除で残りが全完了なら親の報酬が付与される', () => {
            useMobileTaskStore.getState().addTask('親タスク', 'medium');
            const id = useMobileTaskStore.getState().tasks[0].id;
            useMobileTaskStore.getState().addSubtask(id, '完了する方');
            useMobileTaskStore.getState().addSubtask(id, '削除する方');
            const [done, removed] = useMobileTaskStore.getState().tasks[0].subtasks;
            useMobileTaskStore.getState().toggleSubtaskComplete(id, done.id);
            const xpBefore = useMobileGameStore.getState().character.totalXp;

            useMobileTaskStore.getState().deleteSubtask(id, removed.id);

            const task = useMobileTaskStore.getState().tasks[0];
            expect(task.completed).toBe(true);
            expect(useMobileGameStore.getState().character.totalXp).toBe(
                xpBefore + XP_CONFIG.REWARD_BY_PRIORITY.medium,
            );
        });
    });

    describe('統計ログ連携（実績のactiveDaysがタスク削除の影響を受けないための土台）', () => {
        it('タスク完了の確定でtaskXpLogへ記録される', () => {
            useMobileTaskStore.getState().addTask('統計対象', 'high');
            const id = useMobileTaskStore.getState().tasks[0].id;
            completeAndConfirm(id);

            const today = isoToJstYmd(useMobileTaskStore.getState().tasks[0].completedAt)!;
            expect(useMobileStatsStore.getState().taskXpLog[today]).toBe(XP_CONFIG.REWARD_BY_PRIORITY.high);
        });

        it('タスクを削除してもtaskXpLogの記録は消えない（Webと同一セマンティクス）', () => {
            useMobileTaskStore.getState().addTask('削除予定', 'medium');
            const id = useMobileTaskStore.getState().tasks[0].id;
            completeAndConfirm(id);
            const today = isoToJstYmd(useMobileTaskStore.getState().tasks[0].completedAt)!;
            const loggedXp = useMobileStatsStore.getState().taskXpLog[today];
            expect(loggedXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);

            useMobileTaskStore.getState().deleteTask(id);

            expect(useMobileStatsStore.getState().taskXpLog[today]).toBe(loggedXp);
        });

        it('猶予内のUndoでは統計ログに記録されない', () => {
            useMobileTaskStore.getState().addTask('取消対象', 'high');
            const id = useMobileTaskStore.getState().tasks[0].id;
            useMobileTaskStore.getState().toggleTask(id);
            useMobileTaskStore.getState().cancelPendingCompletion(id);
            vi.advanceTimersByTime(5000);

            expect(useMobileStatsStore.getState().taskXpLog).toEqual({});
        });

        it('サブタスク完了でもtaskXpLogへ記録される（他に未完了のサブタスクが残るケース）', () => {
            useMobileTaskStore.getState().addTask('親', 'low');
            const id = useMobileTaskStore.getState().tasks[0].id;
            useMobileTaskStore.getState().addSubtask(id, '完了させる方');
            useMobileTaskStore.getState().addSubtask(id, '残す方');
            const subtaskId = useMobileTaskStore.getState().tasks[0].subtasks[0].id;

            useMobileTaskStore.getState().toggleSubtaskComplete(id, subtaskId);

            // 親は未完了のまま（残り1件が未完了）なので、サブタスク報酬のみ記録される
            const totalLogged = Object.values(useMobileStatsStore.getState().taskXpLog).reduce((a, b) => a + b, 0);
            expect(totalLogged).toBe(getSubtaskRewardXp('low'));
        });

        it('最後のサブタスク完了で親も自動完了した場合、サブタスク報酬と親完了報酬の両方が記録される', () => {
            useMobileTaskStore.getState().addTask('親', 'low');
            const id = useMobileTaskStore.getState().tasks[0].id;
            useMobileTaskStore.getState().addSubtask(id, '唯一のサブタスク');
            const subtaskId = useMobileTaskStore.getState().tasks[0].subtasks[0].id;

            useMobileTaskStore.getState().toggleSubtaskComplete(id, subtaskId);

            const totalLogged = Object.values(useMobileStatsStore.getState().taskXpLog).reduce((a, b) => a + b, 0);
            expect(totalLogged).toBe(getSubtaskRewardXp('low') + XP_CONFIG.REWARD_BY_PRIORITY.low);
        });
    });
});
