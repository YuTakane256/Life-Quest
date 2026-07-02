import { clampString } from './validation';

export interface Habit {
    id: string;
    name: string;
    categoryId: string;
    createdAt: string;
}

export interface HabitDailyRecord {
    habitId: string;
    date: string;
    completed: boolean;
    memo: string;
}

export interface RestDay {
    date: string;
    isRest: boolean;
}

export const HABIT_LIMITS = {
    maxHabits: 500,
    maxRecords: 50_000,
    maxNameLength: 200,
    maxCategoryIdLength: 50,
    maxMemoLength: 500,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createHabit(id: string, name: string, categoryId: string, now: string): Habit | null {
    const safeName = clampString(name.trim(), HABIT_LIMITS.maxNameLength);
    if (!id || !safeName || !now) return null;
    return {
        id,
        name: safeName,
        categoryId: clampString(categoryId, HABIT_LIMITS.maxCategoryIdLength) || 'general',
        createdAt: now,
    };
}

export function toggleHabitDailyRecord(
    records: readonly HabitDailyRecord[],
    habitId: string,
    date: string,
): HabitDailyRecord[] {
    const existing = records.find((record) => record.habitId === habitId && record.date === date);
    if (!existing) {
        return [...records, { habitId, date, completed: true, memo: '' }];
    }
    return records.map((record) => record === existing
        ? { ...record, completed: !record.completed }
        : record
    );
}

/** 指定日にすべての習慣が完了しているか。習慣が1つも無い場合は false。 */
export function areAllHabitsComplete(
    habits: readonly Habit[],
    records: readonly HabitDailyRecord[],
    date: string,
): boolean {
    if (habits.length === 0) return false;
    const completedIds = new Set(
        records
            .filter((record) => record.date === date && record.completed)
            .map((record) => record.habitId),
    );
    return habits.every((habit) => completedIds.has(habit.id));
}

export function removeHabitData(
    habits: readonly Habit[],
    records: readonly HabitDailyRecord[],
    habitId: string,
): { habits: Habit[]; records: HabitDailyRecord[] } {
    return {
        habits: habits.filter((habit) => habit.id !== habitId),
        records: records.filter((record) => record.habitId !== habitId),
    };
}

export function sanitizeHabitCollection(value: unknown): Habit[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
        .filter(isRecord)
        .filter((habit) => typeof habit.id === 'string' && typeof habit.name === 'string')
        .map((habit) => ({
            id: habit.id as string,
            name: clampString(habit.name as string, HABIT_LIMITS.maxNameLength),
            categoryId: typeof habit.categoryId === 'string'
                ? clampString(habit.categoryId, HABIT_LIMITS.maxCategoryIdLength)
                : 'general',
            createdAt: typeof habit.createdAt === 'string' ? habit.createdAt : '',
        }))
        .filter((habit) => {
            if (!habit.name || seen.has(habit.id)) return false;
            seen.add(habit.id);
            return true;
        })
        .slice(-HABIT_LIMITS.maxHabits);
}

export function sanitizeHabitRecords(value: unknown, habitIds: ReadonlySet<string>): HabitDailyRecord[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
        .filter(isRecord)
        .filter((record) => typeof record.habitId === 'string' && typeof record.date === 'string')
        .map((record) => ({
            habitId: record.habitId as string,
            date: record.date as string,
            completed: record.completed === true,
            memo: typeof record.memo === 'string' ? clampString(record.memo, HABIT_LIMITS.maxMemoLength) : '',
        }))
        .filter((record) => {
            const key = `${record.habitId}:${record.date}`;
            if (!habitIds.has(record.habitId) || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(-HABIT_LIMITS.maxRecords);
}
