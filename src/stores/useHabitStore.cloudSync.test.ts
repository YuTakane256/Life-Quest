import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHabitStore } from './useHabitStore';
import { useGameStore } from './useGameStore';
import { getTodayJST } from '../utils/dateUtils';
import { XP_CONFIG } from '../config/gameConfig';
import { enqueueCloudOperation } from '../platform/cloudOutbox';

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async () => true),
}));

const enqueueMock = vi.mocked(enqueueCloudOperation);

function resetStore() {
    localStorage.clear();
    useHabitStore.setState({ habits: [], dailyRecords: [], restDays: [], allCompleteRewardDates: [] });
    useGameStore.setState((state) => ({ character: { ...state.character, totalXp: 0 }, gachaCount: 0 }));
}

// 全達成報酬の付与はsetTimeout(0)＋動的importの連鎖で行われ、fake timersでは
// importの解決が進まないため、既存のuseHabitStore.test.tsと同様に実タイマーを使う。
describe('useHabitStore クラウド同期の配線', () => {
    beforeEach(() => {
        vi.useRealTimers();
        resetStore();
        enqueueMock.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('addHabitはupsert_habitをenqueueする', () => {
        useHabitStore.getState().addHabit('運動', 'health');
        const habit = useHabitStore.getState().habits[0];

        expect(enqueueMock).toHaveBeenCalledWith('upsert_habit', {
            p_id: habit.id,
            p_name: '運動',
            p_category_id: 'health',
        }, { trackEntityId: habit.id });
    });

    it('deleteHabitはdelete_habitをenqueueする', () => {
        useHabitStore.getState().addHabit('運動');
        const id = useHabitStore.getState().habits[0].id;
        enqueueMock.mockClear();

        useHabitStore.getState().deleteHabit(id);

        expect(enqueueMock).toHaveBeenCalledWith('delete_habit', { p_id: id }, { dependsOnEntityIds: [id] });
    });

    it('toggleHabitCompletionはset_habit_logをenqueueする（completed/memoの絶対状態）', async () => {
        useHabitStore.getState().addHabit('運動');
        const habitId = useHabitStore.getState().habits[0].id;
        const date = getTodayJST();
        enqueueMock.mockClear();

        useHabitStore.getState().toggleHabitCompletion(habitId, date);

        expect(enqueueMock).toHaveBeenCalledWith('set_habit_log', {
            p_habit_id: habitId,
            p_date: date,
            p_completed: true,
            p_memo: '',
        }, { dependsOnEntityIds: [habitId], trackEntityId: habitId });

        // このテストは単一habitのため全達成扱いとなり、setTimeout(0)内でclaim_habit_bonusも
        // 送られる。次テストへ影響しないよう、その完了まで確実に待つ。
        await vi.waitFor(() => expect(enqueueMock).toHaveBeenCalledWith(
            'claim_habit_bonus', { date }, { dependsOnEntityIds: [habitId] },
        ));
    });

    it('全達成でclaim_habit_bonusがset_habit_logの後にenqueueされる', async () => {
        useHabitStore.getState().addHabit('Habit 1');
        useHabitStore.getState().addHabit('Habit 2');
        const [habit1, habit2] = useHabitStore.getState().habits;
        const date = getTodayJST();

        useHabitStore.getState().toggleHabitCompletion(habit1.id, date);
        useHabitStore.getState().toggleHabitCompletion(habit2.id, date);

        await vi.waitFor(() => {
            expect(useGameStore.getState().character.totalXp).toBe(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS);
        });
        // 2件のtoggle呼び出しはそれぞれ独立したsetTimeout(0)で全達成チェックを行うため、
        // 先に呼ばれたtoggle（habit1）のコールバックがレースに勝ち、報酬・claim送信を行う
        await vi.waitFor(() => expect(enqueueMock).toHaveBeenCalledWith(
            'claim_habit_bonus', { date }, { dependsOnEntityIds: [habit1.id] },
        ));

        const operations = enqueueMock.mock.calls.map((call) => call[0]);
        const lastSetHabitLogIndex = operations.lastIndexOf('set_habit_log');
        const claimIndex = operations.indexOf('claim_habit_bonus');
        expect(lastSetHabitLogIndex).toBeGreaterThanOrEqual(0);
        expect(lastSetHabitLogIndex).toBeLessThan(claimIndex);

        // habit2側のコールバックはshouldAwardReward=falseで早期returnするだけだが、
        // 次テストへ影響しないよう完全に片付くまで待つ。
        await new Promise((resolve) => setTimeout(resolve, 20));
    });

    it('setHabitMemoはset_habit_logをenqueueする', () => {
        useHabitStore.getState().addHabit('運動');
        const habitId = useHabitStore.getState().habits[0].id;
        const date = getTodayJST();
        enqueueMock.mockClear();

        useHabitStore.getState().setHabitMemo(habitId, date, 'メモ');

        expect(enqueueMock).toHaveBeenCalledWith('set_habit_log', {
            p_habit_id: habitId,
            p_date: date,
            p_completed: false,
            p_memo: 'メモ',
        }, { dependsOnEntityIds: [habitId], trackEntityId: habitId });
    });

    it('setRestDayはset_rest_dayをenqueueする', () => {
        const date = getTodayJST();
        useHabitStore.getState().setRestDay(date);

        expect(enqueueMock).toHaveBeenCalledWith('set_rest_day', { p_date: date, p_active: true });
    });
});
