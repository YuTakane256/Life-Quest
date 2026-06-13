import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHabitStore } from './useHabitStore';
import { UI_CONFIG } from '../config/gameConfig';
import { getTodayJST, shiftDate } from '../utils/dateUtils';
import type { Habit, HabitDailyRecord, RestDay } from '../types';

function resetStore() {
    localStorage.clear();
    useHabitStore.setState({
        habits: [],
        dailyRecords: [],
        restDays: [],
    });
}

function makeHabit(overrides: Partial<Habit> = {}): Habit {
    return {
        id: 'habit-' + Math.random().toString(36).slice(2, 8),
        name: '習慣',
        categoryId: 'health',
        createdAt: '2025-05-01T00:00:00.000Z',
        ...overrides,
    };
}

function makeRecord(overrides: Partial<HabitDailyRecord> = {}): HabitDailyRecord {
    return {
        habitId: 'habit-a',
        date: '2025-05-10',
        completed: true,
        memo: '',
        ...overrides,
    };
}

function makeRestDay(overrides: Partial<RestDay> = {}): RestDay {
    return {
        date: '2025-05-10',
        isRest: true,
        ...overrides,
    };
}

describe('useHabitStore edge coverage', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-05-10T12:00:00.000Z'));
        resetStore();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('deleteHabit は対象習慣と関連 dailyRecords だけを削除する', () => {
        const keepHabit = makeHabit({ id: 'keep' });
        const deleteHabit = makeHabit({ id: 'delete' });
        useHabitStore.setState({
            habits: [keepHabit, deleteHabit],
            dailyRecords: [
                makeRecord({ habitId: 'keep', date: '2025-05-10' }),
                makeRecord({ habitId: 'delete', date: '2025-05-10' }),
                makeRecord({ habitId: 'delete', date: '2025-05-09', memo: 'old' }),
            ],
            restDays: [makeRestDay({ date: '2025-05-09' })],
        });

        useHabitStore.getState().deleteHabit('delete');

        expect(useHabitStore.getState().habits).toEqual([keepHabit]);
        expect(useHabitStore.getState().dailyRecords).toEqual([
            makeRecord({ habitId: 'keep', date: '2025-05-10' }),
        ]);
        expect(useHabitStore.getState().restDays).toEqual([makeRestDay({ date: '2025-05-09' })]);
    });

    it('setHabitMemo は既存レコードの完了状態を保ったままメモを最大長に丸める', () => {
        const longMemo = 'a'.repeat(UI_CONFIG.MAX_HABIT_MEMO_LENGTH + 20);
        useHabitStore.setState({
            habits: [makeHabit({ id: 'habit-a' })],
            dailyRecords: [makeRecord({ habitId: 'habit-a', completed: true, memo: 'before' })],
        });

        useHabitStore.getState().setHabitMemo('habit-a', '2025-05-10', longMemo);
        const record = useHabitStore.getState().dailyRecords[0];

        expect(record.completed).toBe(true);
        expect(record.memo).toHaveLength(UI_CONFIG.MAX_HABIT_MEMO_LENGTH);
        expect(record.memo).toBe(longMemo.slice(0, UI_CONFIG.MAX_HABIT_MEMO_LENGTH));
    });

    it('getTodayRecords はJSTの今日に一致する記録だけ返す', () => {
        const today = getTodayJST();
        useHabitStore.setState({
            dailyRecords: [
                makeRecord({ habitId: 'habit-a', date: today }),
                makeRecord({ habitId: 'habit-b', date: today, completed: false }),
                makeRecord({ habitId: 'habit-a', date: shiftDate(today, -1) }),
            ],
        });

        expect(useHabitStore.getState().getTodayRecords()).toEqual([
            makeRecord({ habitId: 'habit-a', date: today }),
            makeRecord({ habitId: 'habit-b', date: today, completed: false }),
        ]);
    });

    it('setRestDay は同じ日付のレコードを重複させず true に戻す', () => {
        const today = getTodayJST();
        useHabitStore.setState({
            restDays: [makeRestDay({ date: today, isRest: false })],
        });

        useHabitStore.getState().setRestDay(today);
        useHabitStore.getState().setRestDay(today);

        expect(useHabitStore.getState().restDays).toEqual([makeRestDay({ date: today, isRest: true })]);
        expect(useHabitStore.getState().isRestDay(today)).toBe(true);
    });

    it('checkAndResetHabits は30日より古い記録だけを削除し、境界日は残す', () => {
        const today = getTodayJST();
        const cutoff = shiftDate(today, -30);
        const tooOld = shiftDate(today, -31);
        useHabitStore.setState({
            dailyRecords: [
                makeRecord({ date: tooOld, memo: 'drop' }),
                makeRecord({ date: cutoff, memo: 'keep-cutoff' }),
                makeRecord({ date: today, memo: 'keep-today' }),
            ],
            restDays: [
                makeRestDay({ date: tooOld }),
                makeRestDay({ date: cutoff }),
                makeRestDay({ date: today }),
            ],
        });

        useHabitStore.getState().checkAndResetHabits();

        expect(useHabitStore.getState().dailyRecords.map((record) => record.date)).toEqual([cutoff, today]);
        expect(useHabitStore.getState().restDays.map((restDay) => restDay.date)).toEqual([cutoff, today]);
    });

    it('getHabitStreak は保持期間の31日分までを連続日数として数える', () => {
        const today = getTodayJST();
        const habit = makeHabit({ id: 'habit-a', createdAt: '2025-04-01T00:00:00.000Z' });
        useHabitStore.setState({
            habits: [habit],
            dailyRecords: Array.from({ length: 36 }, (_, index) =>
                makeRecord({ habitId: habit.id, date: shiftDate(today, -index), completed: true })
            ),
        });

        expect(useHabitStore.getState().getHabitStreak(habit.id)).toBe(31);
    });

    it('getHabitCompletionRate は作成前とお休み日を分母から除外する', () => {
        const today = getTodayJST();
        const habit = makeHabit({ id: 'habit-a', createdAt: `${shiftDate(today, -4)}T00:00:00.000Z` });
        useHabitStore.setState({
            habits: [habit],
            dailyRecords: [
                makeRecord({ habitId: habit.id, date: today, completed: true }),
                makeRecord({ habitId: habit.id, date: shiftDate(today, -1), completed: true }),
                makeRecord({ habitId: habit.id, date: shiftDate(today, -2), completed: true }),
                makeRecord({ habitId: habit.id, date: shiftDate(today, -6), completed: true }),
            ],
            restDays: [makeRestDay({ date: shiftDate(today, -1) })],
        });

        expect(useHabitStore.getState().getHabitCompletionRate(habit.id)).toBe(50);
    });
});
