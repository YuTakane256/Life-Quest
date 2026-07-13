import AsyncStorage from '@react-native-async-storage/async-storage';
import { HABIT_LIMITS, createHabit, type Habit } from '@life-quest/core/habits';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { XP_CONFIG } from '@life-quest/core/progression';
import { useMobileGameStore } from './useMobileGameStore';
import { useMobileHabitStore } from './useMobileHabitStore';
import { useMobileStatsStore } from './useMobileStatsStore';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

const storage = vi.mocked(AsyncStorage);

function habit(id: string): Habit {
    const value = createHabit(id, `Habit ${id}`, 'general', '2026-07-02T00:00:00.000Z');
    if (!value) throw new Error('Test habit must be valid');
    return value;
}

describe('useMobileHabitStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useMobileHabitStore.setState({ habits: [], records: [], restDays: [], rewardEligibleDates: [], hasHydrated: true });
        useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, lastLevelUp: null });
        useMobileStatsStore.setState({ taskXpLog: {}, habitLog: {}, seeded: true, hasHydrated: true });
    });

    it('adds a normalized habit and rejects an empty name', () => {
        expect(useMobileHabitStore.getState().addHabit('   ')).toBe(false);
        expect(useMobileHabitStore.getState().addHabit('  朝の散歩  ')).toBe(true);

        expect(useMobileHabitStore.getState().habits).toHaveLength(1);
        expect(useMobileHabitStore.getState().habits[0]).toMatchObject({
            name: '朝の散歩',
            categoryId: 'other',
        });
    });

    it('toggles a daily record and removes it with its habit', () => {
        useMobileHabitStore.getState().addHabit('記録確認');
        const id = useMobileHabitStore.getState().habits[0].id;
        const date = '2026-07-02';

        useMobileHabitStore.getState().toggleToday(id, date);
        expect(useMobileHabitStore.getState().records).toEqual([
            { habitId: id, date, completed: true, memo: '' },
        ]);

        useMobileHabitStore.getState().toggleToday(id, date);
        expect(useMobileHabitStore.getState().records[0].completed).toBe(false);

        useMobileHabitStore.getState().deleteHabit(id);
        expect(useMobileHabitStore.getState()).toMatchObject({ habits: [], records: [] });
    });

    it('does not add habits beyond the shared collection limit', () => {
        const habits = Array.from({ length: HABIT_LIMITS.maxHabits }, (_, index) => habit(String(index)));
        useMobileHabitStore.setState({ habits });

        expect(useMobileHabitStore.getState().addHabit('上限超過')).toBe(false);
        expect(useMobileHabitStore.getState().habits).toHaveLength(HABIT_LIMITS.maxHabits);
    });

    it('persists habit data without transient hydration state', async () => {
        useMobileHabitStore.getState().addHabit('保存対象');

        await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
        const [, serialized] = storage.setItem.mock.calls.at(-1) ?? [];
        expect(serialized).toEqual(expect.any(String));
        const envelope = JSON.parse(serialized as string) as { state: Record<string, unknown> };
        expect(envelope.state.habits).toHaveLength(1);
        expect(envelope.state.records).toEqual([]);
        expect(envelope.state.rewardEligibleDates).toEqual([]);
        expect(envelope.state).not.toHaveProperty('hasHydrated');
    });

    it('hydration完了前の追加・変更・削除を無視する', () => {
        useMobileHabitStore.setState({ habits: [habit('h1')], hasHydrated: false });

        expect(useMobileHabitStore.getState().addHabit('復元中')).toBe(false);
        useMobileHabitStore.getState().toggleToday('h1', '2026-07-02');
        useMobileHabitStore.getState().deleteHabit('h1');

        expect(useMobileHabitStore.getState().habits).toHaveLength(1);
        expect(useMobileHabitStore.getState().records).toEqual([]);
        expect(useMobileHabitStore.getState().rewardEligibleDates).toEqual([]);
    });

    describe('ゲーム報酬連携', () => {
        const DATE = '2026-07-02';

        it('全習慣の完了でボーナスXPが1回だけ付与される', () => {
            useMobileHabitStore.setState({ habits: [habit('h1'), habit('h2')] });

            useMobileHabitStore.getState().toggleToday('h1', DATE);
            expect(useMobileGameStore.getState().character.totalXp).toBe(0); // まだ全達成ではない

            useMobileHabitStore.getState().toggleToday('h2', DATE);
            const game = useMobileGameStore.getState();
            expect(game.character.totalXp).toBe(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS);
            expect(game.gachaCount).toBe(1);
            expect(game.rewardLedger.habitBonusDates).toEqual([DATE]);
            expect(useMobileHabitStore.getState().rewardEligibleDates).toEqual([DATE]);
        });

        it('達成解除→再達成しても同日ボーナスは再付与されない', () => {
            useMobileHabitStore.setState({ habits: [habit('h1')] });

            useMobileHabitStore.getState().toggleToday('h1', DATE); // 達成 → ボーナス
            useMobileHabitStore.getState().toggleToday('h1', DATE); // 解除
            useMobileHabitStore.getState().toggleToday('h1', DATE); // 再達成

            expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS);
            expect(useMobileGameStore.getState().gachaCount).toBe(1);
        });

        it('翌日の全達成では再度付与される', () => {
            useMobileHabitStore.setState({ habits: [habit('h1')] });

            useMobileHabitStore.getState().toggleToday('h1', '2026-07-02');
            useMobileHabitStore.getState().toggleToday('h1', '2026-07-03');

            expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS * 2);
            expect(useMobileGameStore.getState().rewardLedger.habitBonusDates).toEqual(['2026-07-02', '2026-07-03']);
            expect(useMobileHabitStore.getState().rewardEligibleDates).toEqual(['2026-07-02', '2026-07-03']);
        });

        it('習慣が1つも無い状態ではボーナスが付与されない', () => {
            useMobileHabitStore.getState().toggleToday('ghost', DATE);
            expect(useMobileGameStore.getState().character.totalXp).toBe(0);
        });
    });

    describe('カテゴリ・メモ・お休み日', () => {
        it('addHabit はカテゴリを保存し、不明なカテゴリは「その他」へ', () => {
            useMobileHabitStore.getState().addHabit('運動', 'health');
            useMobileHabitStore.getState().addHabit('謎', 'plutonium');

            const habits = useMobileHabitStore.getState().habits;
            expect(habits[0].categoryId).toBe('health');
            expect(habits[1].categoryId).toBe('other');
        });

        it('setHabitMemo は既存レコードを更新し、無ければ未完了レコードを作る', () => {
            useMobileHabitStore.setState({ habits: [habit('h1')] });

            useMobileHabitStore.getState().setHabitMemo('h1', '2026-07-05', '朝やった');
            expect(useMobileHabitStore.getState().records).toEqual([
                { habitId: 'h1', date: '2026-07-05', completed: false, memo: '朝やった' },
            ]);

            useMobileHabitStore.getState().toggleToday('h1', '2026-07-05');
            useMobileHabitStore.getState().setHabitMemo('h1', '2026-07-05', '更新後');
            const record = useMobileHabitStore.getState().records.find(
                (candidate) => candidate.habitId === 'h1' && candidate.date === '2026-07-05',
            );
            expect(record).toMatchObject({ completed: true, memo: '更新後' });
        });

        it('setHabitMemo はメモを500文字でclampし、不正日付・不明習慣を拒否する', () => {
            useMobileHabitStore.setState({ habits: [habit('h1')] });

            useMobileHabitStore.getState().setHabitMemo('h1', '2026-07-05', 'あ'.repeat(600));
            expect(useMobileHabitStore.getState().records[0].memo).toHaveLength(500);

            useMobileHabitStore.getState().setHabitMemo('h1', 'not-a-date', 'x');
            useMobileHabitStore.getState().setHabitMemo('ghost', '2026-07-05', 'x');
            expect(useMobileHabitStore.getState().records).toHaveLength(1);
        });

        it('markRestDay がお休み日を保存し、永続化される', async () => {
            useMobileHabitStore.getState().markRestDay('2026-07-05');
            expect(useMobileHabitStore.getState().restDays).toEqual([{ date: '2026-07-05', isRest: true }]);

            await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
            const [, serialized] = storage.setItem.mock.calls.at(-1) ?? [];
            const envelope = JSON.parse(serialized as string) as { state: { restDays: unknown } };
            expect(envelope.state.restDays).toEqual([{ date: '2026-07-05', isRest: true }]);
        });

        it('壊れたrestDaysはmergeでsanitizeされる', () => {
            const persistOptions = useMobileHabitStore.persist.getOptions();
            const merged = persistOptions.merge?.(
                { habits: [], records: [], restDays: [{ date: 'bad' }, { date: '2026-07-01', isRest: true }, 42] },
                useMobileHabitStore.getState(),
            );
            expect(merged?.restDays).toEqual([{ date: '2026-07-01', isRest: true }]);
        });
    });

    describe('統計ログ連携', () => {
        it('toggleTodayでhabitLogにその日の達成数・全達成フラグが記録される', () => {
            // 作成日より前の日付は「達成不要」扱いになる（areAllHabitsComplete）ため、
            // 対象日は両習慣の作成後にする
            useMobileHabitStore.getState().addHabit('運動');
            useMobileHabitStore.getState().addHabit('読書');
            const [h1, h2] = useMobileHabitStore.getState().habits;
            const targetDate = '2099-01-01';

            useMobileHabitStore.getState().toggleToday(h1.id, targetDate);
            expect(useMobileStatsStore.getState().habitLog[targetDate]).toEqual({ count: 1, allComplete: false });

            useMobileHabitStore.getState().toggleToday(h2.id, targetDate);
            expect(useMobileStatsStore.getState().habitLog[targetDate]).toEqual({ count: 2, allComplete: true });
        });

        it('習慣を削除してもhabitLogの過去の記録は消えない（Webと同一セマンティクス）', () => {
            useMobileHabitStore.getState().addHabit('運動');
            const habitId = useMobileHabitStore.getState().habits[0].id;
            useMobileHabitStore.getState().toggleToday(habitId, '2026-07-10');
            expect(useMobileStatsStore.getState().habitLog['2026-07-10']).toEqual({ count: 1, allComplete: true });

            useMobileHabitStore.getState().deleteHabit(habitId);

            expect(useMobileStatsStore.getState().habitLog['2026-07-10']).toEqual({ count: 1, allComplete: true });
        });
    });
});
