import { describe, expect, it } from 'vitest';
import type { Habit, HabitDailyRecord } from '@life-quest/core/habits';
import type { Task } from '@life-quest/core/tasks';
import { buildAchievementSnapshot } from './achievementSnapshot';

function task(overrides: Partial<Task> = {}): Task {
    return {
        id: 't1',
        name: 'タスク',
        dueDate: null,
        priority: 'medium',
        tags: [],
        subtasks: [],
        recurrence: 'none',
        completed: false,
        completedAt: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

function habit(overrides: Partial<Habit> = {}): Habit {
    return { id: 'h1', name: '習慣', categoryId: 'general', createdAt: '2026-07-01T00:00:00.000Z', ...overrides };
}

describe('buildAchievementSnapshot', () => {
    it('activeDaysはXPを獲得した日数（Web taskXpLogの正の日数と同一セマンティクス）', () => {
        const tasks = [
            task({ id: 't1', completed: true, completedAt: '2026-07-01T10:00:00+09:00', priority: 'high' }),
            task({ id: 't2', completed: true, completedAt: '2026-07-01T11:00:00+09:00', priority: 'low' }), // 同日: 1日にまとまる
            task({ id: 't3', completed: true, completedAt: '2026-07-02T10:00:00+09:00', priority: 'medium' }),
            task({ id: 't4', completed: false }), // 未完了は対象外
        ];
        const snapshot = buildAchievementSnapshot({
            tasks, habits: [], records: [], totalXp: 0, maxStage: 0, equipmentCount: 0,
        });
        expect(snapshot.activeDays).toBe(2);
    });

    it('perfectDaysは全習慣達成日数（Web habitLogのallComplete日数と同一セマンティクス）', () => {
        const habits = [habit({ id: 'h1' }), habit({ id: 'h2' })];
        const records: HabitDailyRecord[] = [
            { habitId: 'h1', date: '2026-07-01', completed: true, memo: '' },
            { habitId: 'h2', date: '2026-07-01', completed: true, memo: '' }, // 全達成日
            { habitId: 'h1', date: '2026-07-02', completed: true, memo: '' },
            { habitId: 'h2', date: '2026-07-02', completed: false, memo: '' }, // 未達成日
        ];
        const snapshot = buildAchievementSnapshot({
            tasks: [], habits, records, totalXp: 0, maxStage: 0, equipmentCount: 0,
        });
        expect(snapshot.perfectDays).toBe(1);
    });

    it('totalXp/maxStage/equipmentCountはそのまま透過する', () => {
        const snapshot = buildAchievementSnapshot({
            tasks: [], habits: [], records: [], totalXp: 500, maxStage: 12, equipmentCount: 7,
        });
        expect(snapshot).toMatchObject({ totalXp: 500, maxStage: 12, equipmentCount: 7 });
    });

    it('タスク・習慣が空でも安全に0を返す', () => {
        const snapshot = buildAchievementSnapshot({
            tasks: [], habits: [], records: [], totalXp: 0, maxStage: 0, equipmentCount: 0,
        });
        expect(snapshot).toEqual({ totalXp: 0, activeDays: 0, perfectDays: 0, maxStage: 0, equipmentCount: 0 });
    });
});
