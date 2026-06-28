import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeHabitStoreState, useHabitStore } from './useHabitStore';
import { useGameStore } from './useGameStore';
import { getTodayJST, shiftDate } from '../utils/dateUtils';
import { DEFAULT_CATEGORY_ID } from '../config/habitCategories';
import { CHARACTER_CONFIG, UI_CONFIG, XP_CONFIG } from '../config/gameConfig';

function resetStore() {
    localStorage.clear();
    useHabitStore.setState({
        habits: [],
        dailyRecords: [],
        restDays: [],
        allCompleteRewardDates: [],
    });
    useGameStore.setState({
        character: {
            name: CHARACTER_CONFIG.INITIAL_STATS.name,
            avatar: CHARACTER_CONFIG.INITIAL_STATS.avatar,
            level: CHARACTER_CONFIG.INITIAL_STATS.level,
            totalXp: CHARACTER_CONFIG.INITIAL_STATS.totalXp,
            baseAttack: CHARACTER_CONFIG.INITIAL_STATS.attack,
            baseDefense: CHARACTER_CONFIG.INITIAL_STATS.defense,
            baseMaxHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp,
        },
        debuff: { active: false, expiresAt: null, multiplier: 1 },
        equipment: [],
        gachaCount: 0,
        chestQueue: [],
        levelUpEvent: null,
        pendingChestReveal: null,
    });
}

describe('useHabitStore', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-05-10T12:00:00Z')); // Arbitrary fixed date
        resetStore();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('sanitizeHabitStoreState', () => {
        it('非オブジェクトの永続化データは空配列にする', () => {
            expect(sanitizeHabitStoreState(null)).toEqual({
                habits: [],
                dailyRecords: [],
                restDays: [],
                allCompleteRewardDates: [],
            });
        });

        it('習慣を検証し、カテゴリと名前長を安全な値に丸める', () => {
            const longName = 'a'.repeat(UI_CONFIG.MAX_HABIT_NAME_LENGTH + 10);

            const sanitized = sanitizeHabitStoreState({
                habits: [
                    'broken',
                    { id: 1, name: 'bad', createdAt: '2026-06-13T00:00:00.000Z' },
                    {
                        id: 'habit-1',
                        name: longName,
                        categoryId: 'unknown',
                        createdAt: 'not-a-date',
                    },
                ],
            });

            expect(sanitized.habits).toEqual([
                {
                    id: 'habit-1',
                    name: 'a'.repeat(UI_CONFIG.MAX_HABIT_NAME_LENGTH),
                    categoryId: DEFAULT_CATEGORY_ID,
                    createdAt: '2025-05-10T12:00:00.000Z',
                },
            ]);
        });

        it('日別記録は存在する習慣IDのみ残し、memo と completed を補正する', () => {
            const longMemo = 'm'.repeat(UI_CONFIG.MAX_HABIT_MEMO_LENGTH + 10);

            const sanitized = sanitizeHabitStoreState({
                habits: [
                    {
                        id: 'habit-1',
                        name: '読書',
                        categoryId: 'study',
                        createdAt: '2026-06-13T00:00:00.000Z',
                    },
                ],
                dailyRecords: [
                    {
                        habitId: 'habit-1',
                        date: '2026-06-13',
                        completed: 'yes',
                        memo: longMemo,
                    },
                    {
                        habitId: 'habit-1',
                        date: '2026-02-30',
                        completed: true,
                        memo: 'invalid date',
                    },
                    {
                        habitId: 'missing-habit',
                        date: '2026-06-13',
                        completed: true,
                        memo: 'orphan',
                    },
                    { habitId: 'habit-1', date: 20260613 },
                ],
            });

            expect(sanitized.dailyRecords).toEqual([
                {
                    habitId: 'habit-1',
                    date: '2026-06-13',
                    completed: false,
                    memo: 'm'.repeat(UI_CONFIG.MAX_HABIT_MEMO_LENGTH),
                },
            ]);
        });

        it('お休み日レコードを検証し、不正な isRest は false にする', () => {
            expect(
                sanitizeHabitStoreState({
                    restDays: [
                        { date: '2026-06-13', isRest: true },
                        { date: '2026-06-14', isRest: 'yes' },
                        { date: '2026-02-30', isRest: true },
                        { date: 20260615, isRest: true },
                    ],
                }).restDays
            ).toEqual([
                { date: '2026-06-13', isRest: true },
                { date: '2026-06-14', isRest: false },
            ]);
        });

        it('全習慣達成報酬の日付は日付形式だけを重複なしで残す', () => {
            expect(
                sanitizeHabitStoreState({
                    allCompleteRewardDates: ['2026-06-13', '2026-02-30', 'bad-date', '2026-06-13', 20260614],
                }).allCompleteRewardDates
            ).toEqual(['2026-06-13']);
        });

        it('重複した習慣ID・日別記録・お休み日は後の値を残して1件にする', () => {
            const sanitized = sanitizeHabitStoreState({
                habits: [
                    { id: 'habit-1', name: 'old', categoryId: 'study', createdAt: '2025-01-01T00:00:00.000Z' },
                    { id: 'habit-1', name: 'new', categoryId: 'health', createdAt: '2025-01-02T00:00:00.000Z' },
                ],
                dailyRecords: [
                    { habitId: 'habit-1', date: '2025-05-10', completed: false, memo: 'old' },
                    { habitId: 'habit-1', date: '2025-05-10', completed: true, memo: 'new' },
                ],
                restDays: [
                    { date: '2025-05-10', isRest: false },
                    { date: '2025-05-10', isRest: true },
                ],
            });

            expect(sanitized.habits).toHaveLength(1);
            expect(sanitized.habits[0].name).toBe('new');
            expect(sanitized.dailyRecords).toEqual([
                { habitId: 'habit-1', date: '2025-05-10', completed: true, memo: 'new' },
            ]);
            expect(sanitized.restDays).toEqual([{ date: '2025-05-10', isRest: true }]);
        });
    });

    describe('addHabit & deleteHabit', () => {
        it('should add a habit with correct initial values', () => {
            const { addHabit } = useHabitStore.getState();
            addHabit('Read a book', 'health');

            const state = useHabitStore.getState();
            expect(state.habits).toHaveLength(1);
            expect(state.habits[0].name).toBe('Read a book');
            expect(state.habits[0].categoryId).toBe('health');
            expect(state.habits[0].createdAt.startsWith(getTodayJST())).toBe(true);
        });

        it('should add a habit with DEFAULT_CATEGORY_ID if categoryId is omitted', () => {
            useHabitStore.getState().addHabit('Exercise');
            expect(useHabitStore.getState().habits[0].categoryId).toBe(DEFAULT_CATEGORY_ID);
        });

        it('空の名前を拒否し、不明なカテゴリはデフォルトへ戻す', () => {
            useHabitStore.getState().addHabit('   ', 'health');
            useHabitStore.getState().addHabit('Valid', 'unknown');

            expect(useHabitStore.getState().habits).toHaveLength(1);
            expect(useHabitStore.getState().habits[0]).toMatchObject({
                name: 'Valid',
                categoryId: DEFAULT_CATEGORY_ID,
            });
        });

        it('should delete a habit by id', () => {
            const { addHabit, deleteHabit } = useHabitStore.getState();
            addHabit('Habit 1');
            addHabit('Habit 2');
            
            const habits = useHabitStore.getState().habits;
            expect(habits).toHaveLength(2);

            deleteHabit(habits[0].id);
            expect(useHabitStore.getState().habits).toHaveLength(1);
            expect(useHabitStore.getState().habits[0].id).toBe(habits[1].id);
        });
    });

    describe('toggleHabitCompletion & setHabitMemo', () => {
        it('存在しない習慣IDや不正日付ではレコードを作らない', () => {
            useHabitStore.getState().addHabit('Habit 1');
            const habitId = useHabitStore.getState().habits[0].id;

            useHabitStore.getState().toggleHabitCompletion('missing', '2025-05-10');
            useHabitStore.getState().toggleHabitCompletion(habitId, '2025-02-30');
            useHabitStore.getState().setHabitMemo('missing', '2025-05-10', 'memo');
            useHabitStore.getState().setHabitMemo(habitId, 'bad-date', 'memo');

            expect(useHabitStore.getState().dailyRecords).toEqual([]);
        });
        it('should toggle habit completion for a specific date', () => {
            const { addHabit, toggleHabitCompletion } = useHabitStore.getState();
            addHabit('Habit 1');
            const habitId = useHabitStore.getState().habits[0].id;
            const today = getTodayJST();

            // Toggle on
            toggleHabitCompletion(habitId, today);
            let record = useHabitStore.getState().dailyRecords.find(r => r.habitId === habitId && r.date === today);
            expect(record?.completed).toBe(true);

            // Toggle off
            toggleHabitCompletion(habitId, today);
            record = useHabitStore.getState().dailyRecords.find(r => r.habitId === habitId && r.date === today);
            expect(record?.completed).toBe(false);
        });

        it('should set habit memo and create a record if it does not exist', () => {
            const { addHabit, setHabitMemo } = useHabitStore.getState();
            addHabit('Habit 1');
            const habitId = useHabitStore.getState().habits[0].id;
            const today = getTodayJST();

            setHabitMemo(habitId, today, 'My note');
            const record = useHabitStore.getState().dailyRecords.find(r => r.habitId === habitId && r.date === today);
            expect(record?.memo).toBe('My note');
            expect(record?.completed).toBe(false); // Creating record just for memo doesn't mark it completed
        });

        it('should update existing habit memo', () => {
            const { addHabit, toggleHabitCompletion, setHabitMemo } = useHabitStore.getState();
            addHabit('Habit 1');
            const habitId = useHabitStore.getState().habits[0].id;
            const today = getTodayJST();

            toggleHabitCompletion(habitId, today);
            setHabitMemo(habitId, today, 'Good job');

            const record = useHabitStore.getState().dailyRecords.find(r => r.habitId === habitId && r.date === today);
            expect(record?.completed).toBe(true);
            expect(record?.memo).toBe('Good job');
        });

        it('同じ日の全習慣達成報酬は再達成しても一度だけ付与する', async () => {
            vi.useRealTimers();
            const { addHabit, toggleHabitCompletion } = useHabitStore.getState();
            const today = getTodayJST();

            addHabit('Habit 1');
            addHabit('Habit 2');
            const [habit1, habit2] = useHabitStore.getState().habits;

            toggleHabitCompletion(habit1.id, today);
            toggleHabitCompletion(habit2.id, today);
            await vi.waitFor(() => {
                expect(useGameStore.getState().character.totalXp).toBe(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS);
            });

            expect(useHabitStore.getState().allCompleteRewardDates).toEqual([today]);

            toggleHabitCompletion(habit1.id, today);
            toggleHabitCompletion(habit1.id, today);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(useGameStore.getState().character.totalXp).toBe(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS);
            expect(useGameStore.getState().gachaCount).toBe(1);
            expect(useHabitStore.getState().allCompleteRewardDates).toEqual([today]);
        });
    });

    describe('isRestDay & setRestDay', () => {
        it('should mark a day as rest day and check correctly', () => {
            const { setRestDay, isRestDay } = useHabitStore.getState();
            const today = getTodayJST();
            
            expect(isRestDay(today)).toBe(false);
            setRestDay(today);
            expect(isRestDay(today)).toBe(true);
        });
    });

    describe('areAllHabitsComplete', () => {
        it('should return false if there are no habits', () => {
            expect(useHabitStore.getState().areAllHabitsComplete(getTodayJST())).toBe(false);
        });

        it('should return true if all habits created before or on the given date are completed', () => {
            const { addHabit, toggleHabitCompletion, areAllHabitsComplete } = useHabitStore.getState();
            const today = getTodayJST();
            
            addHabit('Habit 1');
            addHabit('Habit 2');
            const habits = useHabitStore.getState().habits;
            
            expect(areAllHabitsComplete(today)).toBe(false);

            toggleHabitCompletion(habits[0].id, today);
            expect(areAllHabitsComplete(today)).toBe(false);

            toggleHabitCompletion(habits[1].id, today);
            expect(areAllHabitsComplete(today)).toBe(true);
        });

        it('should ignore habits created after the given date', () => {
            const { addHabit, toggleHabitCompletion, areAllHabitsComplete } = useHabitStore.getState();
            const today = getTodayJST();
            const yesterday = shiftDate(today, -1);
            
            // Create habit "yesterday" (by tricking the store with mock timers or mutating state)
            vi.setSystemTime(new Date('2025-05-09T12:00:00Z'));
            addHabit('Old Habit');
            
            vi.setSystemTime(new Date('2025-05-10T12:00:00Z'));
            addHabit('New Habit');

            const oldHabit = useHabitStore.getState().habits.find(h => h.name === 'Old Habit')!;
            
            // Checking yesterday: Only 'Old Habit' matters
            toggleHabitCompletion(oldHabit.id, yesterday);
            expect(areAllHabitsComplete(yesterday)).toBe(true);
        });
    });

    describe('getHabitStreak', () => {
        it('should calculate streak ignoring future days and missing records on RestDays', () => {
            const { addHabit, toggleHabitCompletion, setRestDay, getHabitStreak } = useHabitStore.getState();
            addHabit('Habit 1');
            const habitId = useHabitStore.getState().habits[0].id;
            
            const today = getTodayJST();
            const dayMinus1 = shiftDate(today, -1);
            const dayMinus2 = shiftDate(today, -2);
            const dayMinus3 = shiftDate(today, -3);

            // Change createdAt so it allows streak history
            useHabitStore.setState(state => ({
                habits: [{ ...state.habits[0], createdAt: new Date('2025-05-07T12:00:00Z').toISOString() }]
            }));

            // Day -3: Completed
            toggleHabitCompletion(habitId, dayMinus3);
            // Day -2: Rest day (missed, but forgiven)
            setRestDay(dayMinus2);
            // Day -1: Completed
            toggleHabitCompletion(habitId, dayMinus1);
            // Today: Completed
            toggleHabitCompletion(habitId, today);

            // Streak should be 3 (Day -3, Day -1, Today)
            expect(getHabitStreak(habitId)).toBe(3);
        });

        it('should break streak on unexcused missed days', () => {
            const { addHabit, toggleHabitCompletion, getHabitStreak } = useHabitStore.getState();
            addHabit('Habit 1');
            const habitId = useHabitStore.getState().habits[0].id;
            
            const today = getTodayJST();
            const dayMinus2 = shiftDate(today, -2);

            useHabitStore.setState(state => ({
                habits: [{ ...state.habits[0], createdAt: new Date('2025-05-08T12:00:00Z').toISOString() }]
            }));

            toggleHabitCompletion(habitId, dayMinus2);
            // Day -1 is missed and not a rest day
            toggleHabitCompletion(habitId, today);

            // Streak only includes today
            expect(getHabitStreak(habitId)).toBe(1);
        });

        it('should allow current day to be missed without breaking past streak yet', () => {
            const { addHabit, toggleHabitCompletion, getHabitStreak } = useHabitStore.getState();
            addHabit('Habit 1');
            const habitId = useHabitStore.getState().habits[0].id;
            
            const today = getTodayJST();
            const dayMinus1 = shiftDate(today, -1);

            useHabitStore.setState(state => ({
                habits: [{ ...state.habits[0], createdAt: new Date('2025-05-09T12:00:00Z').toISOString() }]
            }));

            toggleHabitCompletion(habitId, dayMinus1);
            // Today missed

            // Streak is 1 from yesterday
            expect(getHabitStreak(habitId)).toBe(1);
        });
    });

    describe('getHabitCompletionRate', () => {
        it('should return null if no target days (habit just created today and today is rest day)', () => {
            const { addHabit, setRestDay, getHabitCompletionRate } = useHabitStore.getState();
            addHabit('Habit 1');
            const habitId = useHabitStore.getState().habits[0].id;
            const today = getTodayJST();
            setRestDay(today);

            expect(getHabitCompletionRate(habitId)).toBeNull();
        });

        it('should calculate rate excluding rest days', () => {
            const { addHabit, toggleHabitCompletion, setRestDay, getHabitCompletionRate } = useHabitStore.getState();
            addHabit('Habit 1');
            const habitId = useHabitStore.getState().habits[0].id;
            
            const today = getTodayJST();
            const dayMinus1 = shiftDate(today, -1);
            const dayMinus3 = shiftDate(today, -3);

            useHabitStore.setState(state => ({
                habits: [{ ...state.habits[0], createdAt: new Date('2025-05-07T12:00:00Z').toISOString() }]
            }));

            // Day -3: Completed
            toggleHabitCompletion(habitId, dayMinus3);
            // Day -2: Missed
            // Day -1: Rest day (excluded from denominator)
            setRestDay(dayMinus1);
            // Today: Completed
            toggleHabitCompletion(habitId, today);

            // Target days: Day -3, Day -2, Today (3 days)
            // Completed: Day -3, Today (2 days)
            // Rate: 2 / 3
            expect(getHabitCompletionRate(habitId)).toBe(Math.round((2 / 3) * 100));
        });
    });
});
