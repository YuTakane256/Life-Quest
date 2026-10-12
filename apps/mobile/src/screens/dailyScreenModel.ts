import type { Priority, Task } from '@life-quest/core/tasks';
import {
    HABIT_CATEGORIES,
    getHabitCategoryByIdOrDefault,
    getHabitCompletionRate,
    getHabitStreak,
    type Habit,
    type HabitDailyRecord,
    type RestDay,
} from '@life-quest/core/habits';
import { isValidYmd, shiftDate } from '@life-quest/core/dates';

export type TaskSort = 'dueDate' | 'priority' | 'createdAt';
export type DueFilter = 'all' | 'dueSoon' | 'overdue';
export type HabitSort = 'createdAt' | 'name' | 'streak' | 'completionRate';
export const TASK_SORT_OPTIONS = [
    ['dueDate', '期限順'],
    ['priority', '優先度順'],
    ['createdAt', '作成日順'],
] as const;
export const HABIT_SORT_OPTIONS = [
    ['createdAt', '作成順'],
    ['name', '名前順'],
    ['streak', 'ストリーク順'],
    ['completionRate', '達成率順'],
] as const;

export function selectTasks(
    tasks: readonly Task[],
    query: string,
    due: DueFilter,
    priority: 'all' | Priority,
    tags: readonly string[],
    sort: TaskSort,
    today: string,
) {
    const ranks = { high: 0, medium: 1, low: 2 };
    return tasks
        .filter(
            (task) =>
                task.name.toLowerCase().includes(query.trim().toLowerCase()) &&
                tags.every((tag) => task.tags.includes(tag)) &&
                (priority === 'all' || task.priority === priority) &&
                (due === 'all' ||
                    (!task.completed &&
                        task.dueDate !== null &&
                        (due === 'overdue'
                            ? task.dueDate < today
                            : task.dueDate <= today))),
        )
        .sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            if (sort === 'priority')
                return ranks[a.priority] - ranks[b.priority];
            if (sort === 'createdAt')
                return b.createdAt.localeCompare(a.createdAt);
            return (a.dueDate ?? '9999-12-31').localeCompare(
                b.dueDate ?? '9999-12-31',
            );
        });
}

export function groupHabits(
    habits: readonly Habit[],
    records: readonly HabitDailyRecord[],
    restDays: readonly RestDay[],
    category: string | null,
    sort: HabitSort,
    today: string,
) {
    const stats = new Map(
        habits.map((habit) => [
            habit.id,
            {
                streak: getHabitStreak({ habit, records, restDays, today }),
                rate: getHabitCompletionRate({
                    habit,
                    records,
                    restDays,
                    today,
                }),
            },
        ]),
    );
    return HABIT_CATEGORIES.map((group) => ({
        category: group,
        habits: habits
            .filter(
                (habit) =>
                    getHabitCategoryByIdOrDefault(habit.categoryId).id ===
                        group.id &&
                    (!category || group.id === category),
            )
            .sort((a, b) => {
                if (sort === 'name') return a.name.localeCompare(b.name);
                if (sort === 'streak')
                    return stats.get(b.id)!.streak - stats.get(a.id)!.streak;
                if (sort === 'completionRate')
                    return (
                        (stats.get(b.id)!.rate ?? -1) -
                        (stats.get(a.id)!.rate ?? -1)
                    );
                return a.createdAt.localeCompare(b.createdAt);
            })
            .map((habit) => ({ habit, ...stats.get(habit.id)! })),
    })).filter((group) => group.habits.length > 0);
}

export function dueLabel(date: string, today: string) {
    if (!isValidYmd(date)) return date;
    if (date === today) return '今日';
    if (date === shiftDate(today, 1)) return '明日';
    if (date === shiftDate(today, 2)) return '明後日';
    if (date === shiftDate(today, -1)) return '昨日';
    const days = Math.round(
        (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
            86400000,
    );
    return days > 0 ? `${days}日後` : `${-days}日前`;
}
