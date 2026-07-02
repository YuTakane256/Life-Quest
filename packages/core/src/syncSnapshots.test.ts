import { describe, expect, it } from 'vitest';
import {
    convertLegacyHabitSnapshot,
    convertLegacyTaskSnapshot,
    sanitizeCanonicalHabitSnapshot,
    sanitizeCanonicalTaskSnapshot,
    SYNC_SNAPSHOT_LIMITS,
    SYNC_SNAPSHOT_VERSION,
} from './syncSnapshots';
import { TASK_LIMITS } from './tasks';

const fullTask = {
    id: 'task-1',
    name: 'Webのタスク',
    dueDate: '2026-07-05',
    priority: 'high',
    tags: ['重要'],
    subtasks: [{
        id: 'subtask-1',
        name: '確認する',
        completed: true,
        completedAt: '2026-07-03T01:00:00.000Z',
        createdAt: '2026-07-02T01:00:00.000Z',
    }],
    recurrence: 'weekly',
    completed: false,
    completedAt: null,
    createdAt: '2026-07-01T01:00:00.000Z',
};

const habit = {
    id: 'habit-1',
    name: '運動',
    categoryId: 'health',
    createdAt: '2026-07-01T01:00:00.000Z',
};

describe('canonical task snapshots', () => {
    it('Web/Mobile共通のpersist envelopeから完全なTaskを保持する', () => {
        const source = { state: { tasks: [fullTask] }, version: 0 };

        expect(convertLegacyTaskSnapshot(source)).toEqual({
            schemaVersion: SYNC_SNAPSHOT_VERSION,
            tasks: [fullTask],
        });
        expect(source.state.tasks[0]).toBe(fullTask);
    });

    it('重複IDと壊れた要素を除外して既定値を補う', () => {
        const snapshot = sanitizeCanonicalTaskSnapshot({
            schemaVersion: 999,
            tasks: [
                fullTask,
                { ...fullTask, name: '重複' },
                { id: 'task-2', name: '最小', createdAt: '2026-07-03T00:00:00.000Z' },
                null,
            ],
        });

        expect(snapshot.schemaVersion).toBe(1);
        expect(snapshot.tasks).toHaveLength(2);
        expect(snapshot.tasks[1]).toMatchObject({
            id: 'task-2',
            priority: 'medium',
            recurrence: 'none',
            tags: [],
            subtasks: [],
        });
    });

    it('過大な配列は共有上限に収める', () => {
        const tasks = Array.from({ length: TASK_LIMITS.maxTasks + 2 }, (_, index) => ({
            ...fullTask,
            id: `task-${index}`,
        }));

        const snapshot = sanitizeCanonicalTaskSnapshot({ tasks });

        expect(snapshot.tasks).toHaveLength(TASK_LIMITS.maxTasks);
        expect(snapshot.tasks[0].id).toBe('task-2');
    });
});

describe('canonical habit snapshots', () => {
    it('Web形式の履歴、休息日、報酬日を変換する', () => {
        const snapshot = convertLegacyHabitSnapshot({
            state: {
                habits: [habit],
                dailyRecords: [{ habitId: habit.id, date: '2026-07-02', completed: true, memo: '達成' }],
                restDays: [{ date: '2026-07-01', isRest: true }],
                allCompleteRewardDates: ['2026-07-02'],
            },
        });

        expect(snapshot).toEqual({
            schemaVersion: 1,
            habits: [habit],
            dailyRecords: [{ habitId: habit.id, date: '2026-07-02', completed: true, memo: '達成' }],
            restDays: [{ date: '2026-07-01', isRest: true }],
            allCompleteDates: ['2026-07-02'],
        });
    });

    it('Mobile形式のrecordsとrewardEligibleDatesを変換する', () => {
        const snapshot = convertLegacyHabitSnapshot({
            state: {
                habits: [habit],
                records: [{ habitId: habit.id, date: '2026-07-03', completed: true, memo: '' }],
                rewardEligibleDates: ['2026-07-03'],
            },
            version: 0,
        });

        expect(snapshot.dailyRecords).toEqual([
            { habitId: habit.id, date: '2026-07-03', completed: true, memo: '' },
        ]);
        expect(snapshot.restDays).toEqual([]);
        expect(snapshot.allCompleteDates).toEqual(['2026-07-03']);
    });

    it('不正日付、孤立レコード、重複値を除外する', () => {
        const snapshot = sanitizeCanonicalHabitSnapshot({
            habits: [habit, { ...habit }],
            dailyRecords: [
                { habitId: habit.id, date: '2026-02-29', completed: true, memo: '' },
                { habitId: habit.id, date: '2026-02-28', completed: true, memo: '' },
                { habitId: 'missing', date: '2026-02-28', completed: true, memo: '' },
            ],
            restDays: [
                { date: 'bad', isRest: true },
                { date: '2026-03-01', isRest: true },
                { date: '2026-03-01', isRest: false },
            ],
            allCompleteDates: ['bad', '2026-02-28', '2026-02-28'],
        });

        expect(snapshot.habits).toEqual([habit]);
        expect(snapshot.dailyRecords).toEqual([
            { habitId: habit.id, date: '2026-02-28', completed: true, memo: '' },
        ]);
        expect(snapshot.restDays).toEqual([{ date: '2026-03-01', isRest: false }]);
        expect(snapshot.allCompleteDates).toEqual(['2026-02-28']);
    });

    it('正規形式を再sanitizeしても同じ内容を維持する', () => {
        const first = convertLegacyHabitSnapshot({
            habits: [habit],
            records: [{ habitId: habit.id, date: '2026-07-03', completed: true, memo: '' }],
            rewardEligibleDates: ['2026-07-03'],
        });

        expect(sanitizeCanonicalHabitSnapshot(first)).toEqual(first);
    });

    it('報酬日付は重複を除き上限内の新しい入力を保持する', () => {
        const allCompleteDates = Array.from(
            { length: SYNC_SNAPSHOT_LIMITS.maxAllCompleteDates + 2 },
            (_, index) => new Date(Date.UTC(2000, 0, index + 1)).toISOString().slice(0, 10),
        );

        const snapshot = sanitizeCanonicalHabitSnapshot({
            habits: [habit],
            allCompleteDates,
        });

        expect(snapshot.allCompleteDates).toHaveLength(SYNC_SNAPSHOT_LIMITS.maxAllCompleteDates);
        expect(snapshot.allCompleteDates[0]).toBe(allCompleteDates[2]);
        expect(new Set(snapshot.allCompleteDates).size).toBe(snapshot.allCompleteDates.length);
    });
});
