import { describe, expect, it } from 'vitest';
import { createTask } from '@life-quest/core/tasks';
import { dueLabel, groupHabits, selectTasks } from './dailyScreenModel';

const today = '2026-08-10';
const tasks = [
    createTask({
        id: 'a',
        name: 'Alpha',
        priority: 'high',
        dueDate: '2026-08-09',
        tags: ['仕事', '急ぎ'],
        now: '2026-08-01T00:00:00Z',
    })!,
    createTask({
        id: 'b',
        name: 'Beta',
        priority: 'medium',
        dueDate: today,
        tags: ['仕事'],
        now: '2026-08-02T00:00:00Z',
    })!,
    createTask({
        id: 'c',
        name: 'Gamma',
        priority: 'low',
        dueDate: null,
        now: '2026-08-03T00:00:00Z',
    })!,
];

describe('daily task presentation', () => {
    it('combines trimmed case-insensitive name, priority and AND tag filters', () => {
        expect(
            selectTasks(
                tasks,
                ' AL ',
                'all',
                'high',
                ['仕事', '急ぎ'],
                'dueDate',
                today,
            ).map((task) => task.id),
        ).toEqual(['a']);
        expect(
            selectTasks(
                tasks,
                '',
                'all',
                'all',
                ['仕事', 'missing'],
                'dueDate',
                today,
            ),
        ).toEqual([]);
    });
    it('matches Web today/overdue filters and excludes completed/no-due tasks', () => {
        expect(
            selectTasks(tasks, '', 'dueSoon', 'all', [], 'dueDate', today).map(
                (task) => task.id,
            ),
        ).toEqual(['a', 'b']);
        expect(
            selectTasks(tasks, '', 'overdue', 'all', [], 'dueDate', today).map(
                (task) => task.id,
            ),
        ).toEqual(['a']);
        expect(
            selectTasks(
                tasks.map((task) => ({ ...task, completed: true })),
                '',
                'overdue',
                'all',
                [],
                'dueDate',
                today,
            ),
        ).toEqual([]);
    });
    it.each(['dueDate', 'priority', 'createdAt'] as const)(
        'always groups completed tasks last with %s sorting',
        (sort) => {
            const source = tasks.map((task) => ({
                ...task,
                completed: task.id === 'a',
            }));
            expect(
                selectTasks(source, '', 'all', 'all', [], sort, today).at(-1)
                    ?.id,
            ).toBe('a');
            expect(source.map((task) => task.id)).toEqual(['a', 'b', 'c']);
        },
    );
    it('sorts by newest creation date without mutating saved data', () => {
        expect(
            selectTasks(tasks, '', 'all', 'all', [], 'createdAt', today).map(
                (task) => task.id,
            ),
        ).toEqual(['c', 'b', 'a']);
        expect(tasks.map((task) => task.id)).toEqual(['a', 'b', 'c']);
    });
    it('formats relative dates across month boundaries', () => {
        expect(dueLabel('2026-08-01', '2026-07-31')).toBe('明日');
        expect(dueLabel(today, today)).toBe('今日');
        expect(dueLabel('2026-08-09', today)).toBe('昨日');
    });
});

describe('daily habit presentation', () => {
    const habits = [
        {
            id: 'h1',
            name: '読書',
            categoryId: 'study',
            createdAt: '2026-08-01T00:00:00Z',
        },
        {
            id: 'h2',
            name: '散歩',
            categoryId: 'health',
            createdAt: '2026-08-02T00:00:00Z',
        },
        {
            id: 'h3',
            name: '復習',
            categoryId: 'study',
            createdAt: '2026-08-03T00:00:00Z',
        },
    ];
    it('uses shared category order rather than insertion order', () => {
        expect(
            groupHabits(habits, [], [], null, 'createdAt', today).map(
                (group) => group.category.id,
            ),
        ).toEqual(['health', 'study']);
    });
    it('filters a category and sorts its records oldest first', () => {
        expect(
            groupHabits(
                habits,
                [],
                [],
                'study',
                'createdAt',
                today,
            )[0].habits.map((item) => item.habit.id),
        ).toEqual(['h1', 'h3']);
    });
    it('updates streak/rate ordering from shared record data', () => {
        const records = [
            { habitId: 'h3', date: today, completed: true, memo: 'test' },
        ];
        const group = groupHabits(
            habits,
            records,
            [],
            'study',
            'streak',
            today,
        )[0];
        expect(group.habits[0].habit.id).toBe('h3');
        expect(group.habits[0].streak).toBe(1);
        expect(habits[0].id).toBe('h1');
    });
    it('normalizes unknown categories to the shared fallback', () => {
        expect(
            groupHabits(
                [{ ...habits[0], categoryId: 'unknown' }],
                [],
                [],
                null,
                'createdAt',
                today,
            )[0].category.id,
        ).toBe('other');
    });
});
