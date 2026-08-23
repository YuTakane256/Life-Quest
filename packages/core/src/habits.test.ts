import { describe, expect, it } from 'vitest';
import {
    areAllHabitsComplete,
    createHabit,
    getHabitCategoryByIdOrDefault,
    getHabitCompletionRate,
    getHabitStreak,
    HABIT_CATEGORIES,
    isRestDayOn,
    markRestDay,
    sanitizeRestDays,
    removeHabitData,
    sanitizeHabitCollection,
    sanitizeHabitRecords,
    toggleHabitDailyRecord,
} from './habits.ts';

describe('habit domain', () => {
    it('creates a normalized habit', () => {
        expect(createHabit('h1', '  運動  ', 'health', '2026-07-01T00:00:00.000Z')).toEqual({
            id: 'h1',
            name: '運動',
            categoryId: 'health',
            createdAt: '2026-07-01T00:00:00.000Z',
        });
        expect(createHabit('h1', ' ', 'health', 'now')).toBeNull();
    });

    it('creates and toggles a daily record', () => {
        const completed = toggleHabitDailyRecord([], 'h1', '2026-07-01');
        expect(completed).toEqual([{ habitId: 'h1', date: '2026-07-01', completed: true, memo: '' }]);
        expect(toggleHabitDailyRecord(completed, 'h1', '2026-07-01')[0].completed).toBe(false);
    });

    it('removes a habit together with its records', () => {
        const habit = createHabit('h1', '運動', 'health', 'now')!;
        expect(removeHabitData([habit], [{ habitId: 'h1', date: '2026-07-01', completed: true, memo: '' }], 'h1')).toEqual({ habits: [], records: [] });
    });

    it('sanitizes duplicate habits and orphan records', () => {
        const habits = sanitizeHabitCollection([{ id: 'h1', name: '運動' }, { id: 'h1', name: '重複' }, null]);
        expect(habits).toHaveLength(1);
        const records = sanitizeHabitRecords([
            { habitId: 'h1', date: '2026-07-01', completed: true },
            { habitId: 'missing', date: '2026-07-01', completed: true },
        ], new Set(['h1']));
        expect(records).toEqual([{ habitId: 'h1', date: '2026-07-01', completed: true, memo: '' }]);
    });
});

describe('areAllHabitsComplete', () => {
    const habits = [
        createHabit('h1', '運動', 'health', 'now')!,
        createHabit('h2', '読書', 'learning', 'now')!,
    ];

    it('全習慣が完了した日に true を返す', () => {
        const records = [
            { habitId: 'h1', date: '2026-07-02', completed: true, memo: '' },
            { habitId: 'h2', date: '2026-07-02', completed: true, memo: '' },
        ];
        expect(areAllHabitsComplete(habits, records, '2026-07-02')).toBe(true);
    });

    it('未完了の習慣が残っていれば false', () => {
        const records = [
            { habitId: 'h1', date: '2026-07-02', completed: true, memo: '' },
            { habitId: 'h2', date: '2026-07-02', completed: false, memo: '' },
        ];
        expect(areAllHabitsComplete(habits, records, '2026-07-02')).toBe(false);
    });

    it('別の日付のレコードは数えない', () => {
        const records = [
            { habitId: 'h1', date: '2026-07-01', completed: true, memo: '' },
            { habitId: 'h2', date: '2026-07-01', completed: true, memo: '' },
        ];
        expect(areAllHabitsComplete(habits, records, '2026-07-02')).toBe(false);
    });

    it('習慣が1つも無ければ false', () => {
        expect(areAllHabitsComplete([], [], '2026-07-02')).toBe(false);
    });
});

describe('habit categories', () => {
    it('8カテゴリが定義され、既定は「その他」', () => {
        expect(HABIT_CATEGORIES).toHaveLength(8);
        expect(getHabitCategoryByIdOrDefault('health').name).toBe('健康');
        expect(getHabitCategoryByIdOrDefault('unknown').id).toBe('other');
        expect(getHabitCategoryByIdOrDefault(42).id).toBe('other');
    });
});

describe('areAllHabitsComplete: 作成日の除外', () => {
    it('指定日より後に作成された習慣は達成不要とみなす', () => {
        const oldHabit = createHabit('h1', '運動', 'health', '2026-06-01T00:00:00.000Z')!;
        const newHabit = createHabit('h2', '新習慣', 'study', '2026-07-05T00:00:00.000Z')!;
        const records = [{ habitId: 'h1', date: '2026-07-01', completed: true, memo: '' }];

        expect(areAllHabitsComplete([oldHabit, newHabit], records, '2026-07-01')).toBe(true);
        // 作成日当日以降は達成が必要
        expect(areAllHabitsComplete([oldHabit, newHabit], records, '2026-07-05')).toBe(false);
    });
});

describe('お休み日', () => {
    it('markRestDay は日付を追加し、既存日はisRestをtrueへ', () => {
        const first = markRestDay([], '2026-07-03', 10);
        expect(first).toEqual([{ date: '2026-07-03', isRest: true }]);
        const second = markRestDay([{ date: '2026-07-03', isRest: false }], '2026-07-03', 10);
        expect(second).toEqual([{ date: '2026-07-03', isRest: true }]);
        expect(markRestDay([], 'invalid', 10)).toEqual([]);
    });

    it('isRestDayOn は isRest=true の日だけ true', () => {
        const restDays = [{ date: '2026-07-03', isRest: true }, { date: '2026-07-04', isRest: false }];
        expect(isRestDayOn(restDays, '2026-07-03')).toBe(true);
        expect(isRestDayOn(restDays, '2026-07-04')).toBe(false);
        expect(isRestDayOn(restDays, '2026-07-05')).toBe(false);
    });

    it('sanitizeRestDays は不正・重複を除去し上限でcapする', () => {
        const result = sanitizeRestDays([
            { date: '2026-07-01', isRest: true },
            { date: '2026-07-01', isRest: false }, // 重複（後勝ち）
            { date: 'bad', isRest: true },
            'garbage',
            { date: '2026-07-02', isRest: 'yes' },
        ], 10);
        expect(result).toEqual([
            { date: '2026-07-01', isRest: false },
            { date: '2026-07-02', isRest: false },
        ]);
        expect(sanitizeRestDays('x', 10)).toEqual([]);
    });
});

describe('getHabitStreak', () => {
    const habit = createHabit('h1', '運動', 'health', '2026-06-01T00:00:00.000Z')!;
    const TODAY = '2026-07-05';
    const record = (date: string) => ({ habitId: 'h1', date, completed: true, memo: '' });

    it('今日から連続した達成日数を数える', () => {
        const records = [record('2026-07-05'), record('2026-07-04'), record('2026-07-03'), record('2026-07-01')];
        expect(getHabitStreak({ habit, records, restDays: [], today: TODAY })).toBe(3);
    });

    it('今日が未完了でも過去分のストリークを保つ', () => {
        const records = [record('2026-07-04'), record('2026-07-03')];
        expect(getHabitStreak({ habit, records, restDays: [], today: TODAY })).toBe(2);
    });

    it('お休み日はスキップして途切れず、カウントもしない', () => {
        const records = [record('2026-07-05'), record('2026-07-03')];
        const restDays = [{ date: '2026-07-04', isRest: true }];
        expect(getHabitStreak({ habit, records, restDays, today: TODAY })).toBe(2);
    });

    it('作成日より前へは遡らない', () => {
        const lateHabit = createHabit('h2', '新習慣', 'study', '2026-07-04T00:00:00.000Z')!;
        const records = [
            { habitId: 'h2', date: '2026-07-05', completed: true, memo: '' },
            { habitId: 'h2', date: '2026-07-04', completed: true, memo: '' },
            { habitId: 'h2', date: '2026-07-03', completed: true, memo: '' }, // 作成前
        ];
        expect(getHabitStreak({ habit: lateHabit, records, restDays: [], today: TODAY })).toBe(2);
    });
});

describe('getHabitCompletionRate', () => {
    const habit = createHabit('h1', '運動', 'health', '2026-06-01T00:00:00.000Z')!;
    const TODAY = '2026-07-05';

    it('過去30日の達成率を返す（お休み日は分母から除外）', () => {
        const records = [
            { habitId: 'h1', date: '2026-07-05', completed: true, memo: '' },
            { habitId: 'h1', date: '2026-07-04', completed: true, memo: '' },
            { habitId: 'h1', date: '2026-07-03', completed: true, memo: '' },
        ];
        const restDays = [{ date: '2026-07-02', isRest: true }];
        // 分母 = 30 - お休み1 = 29、分子 = 3
        expect(getHabitCompletionRate({ habit, records, restDays, today: TODAY })).toBe(Math.round((3 / 29) * 100));
    });

    it('作成から日が浅い習慣は経過日数だけで計算する', () => {
        const young = createHabit('h2', '新習慣', 'study', '2026-07-03T00:00:00.000Z')!;
        const records = [
            { habitId: 'h2', date: '2026-07-05', completed: true, memo: '' },
            { habitId: 'h2', date: '2026-07-04', completed: false, memo: '' },
        ];
        // 対象は 7/3〜7/5 の3日、完了1 → 33%
        expect(getHabitCompletionRate({ habit: young, records, restDays: [], today: TODAY })).toBe(33);
    });

    it('対象日が無ければ null', () => {
        const future = createHabit('h3', '未来習慣', 'study', '2026-08-01T00:00:00.000Z')!;
        expect(getHabitCompletionRate({ habit: future, records: [], restDays: [], today: TODAY })).toBeNull();
    });

    it('暦上無効なtodayも旧shiftYmdと同じDate正規化で集計する', () => {
        const oldHabit = createHabit('h4', '継続習慣', 'health', '2024-01-01T00:00:00.000Z')!;
        expect(getHabitCompletionRate({ habit: oldHabit, records: [], restDays: [], today: '2025-02-29' }, 2)).toBe(0);
    });
});
