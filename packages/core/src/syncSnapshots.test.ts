import { describe, expect, it } from 'vitest';
import {
    convertLegacyGameSnapshot,
    convertLegacyHabitSnapshot,
    convertLegacyTaskSnapshot,
    sanitizeCanonicalGameSnapshot,
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

describe('canonical game snapshots', () => {
    it('Web形式のゲーム、称号、バトル進行と報酬証跡を統合する', () => {
        const completedTask = { ...fullTask, completed: true };
        const snapshot = convertLegacyGameSnapshot({
            game: {
                state: {
                    character: { name: '勇者', avatar: 'male', totalXp: 30 },
                    equipment: [{ id: 'equipment-1', templateId: 'wooden_sword', equipped: true }],
                    chestQueue: [{
                        id: 'chest-1',
                        chestType: 'wood',
                        label: '木の宝箱',
                        opened: false,
                        equipment: null,
                    }],
                    gachaCount: 8,
                    debuff: { active: true, expiresAt: '2026-07-04T00:00:00+09:00', multiplier: 0.5 },
                    battle: {
                        status: 'fighting',
                        currentStage: 12,
                        maxClearedStage: 11,
                        battleUnlocked: true,
                        enemy: { name: '同期しない' },
                        logs: [{ message: '同期しない' }],
                    },
                },
            },
            title: { state: { activeTitle: '  継続の火種  ' }, version: 1 },
            tasks: { state: { tasks: [completedTask] } },
            habits: {
                state: {
                    habits: [habit],
                    dailyRecords: [],
                    allCompleteRewardDates: ['2026-07-02'],
                },
            },
        });

        expect(snapshot.character).toMatchObject({ name: '勇者', avatar: 'male', level: 2, totalXp: 30 });
        expect(snapshot.equipment.map((item) => item.id)).toEqual(['equipment-1']);
        expect(snapshot.chestQueue.map((chest) => chest.id)).toEqual(['chest-1']);
        expect(snapshot.gachaCount).toBe(8);
        expect(snapshot.activeTitle).toBe('継続の火種');
        expect(snapshot.debuff).toEqual({ active: true, expiresAt: '2026-07-03T15:00:00.000Z' });
        expect(snapshot.battleProgress).toEqual({
            battleUnlocked: true,
            currentStage: 12,
            maxClearedStage: 11,
        });
        expect(snapshot.battleProgress).not.toHaveProperty('logs');
        expect(snapshot.battleProgress).not.toHaveProperty('enemy');
        expect(snapshot.rewardLedger).toEqual({
            rewardedTaskIds: ['task-1'],
            rewardedSubtaskIds: ['subtask-1'],
            habitBonusDates: ['2026-07-02'],
        });
    });

    it('Mobileの既存報酬台帳を保ち、移行証跡と重複なく統合する', () => {
        const snapshot = convertLegacyGameSnapshot({
            game: {
                state: {
                    character: { name: 'あなた', avatar: 'female', totalXp: 0 },
                    rewardLedger: {
                        rewardedTaskIds: ['task-1', 'mobile-only'],
                        rewardedSubtaskIds: ['subtask-1'],
                        habitBonusDates: ['2026-07-02'],
                    },
                },
                version: 1,
            },
            tasks: { tasks: [{ ...fullTask, completed: true }] },
            habits: {
                habits: [habit],
                records: [],
                rewardEligibleDates: ['2026-07-02', '2026-07-03'],
            },
        });

        expect(snapshot.rewardLedger).toEqual({
            rewardedTaskIds: ['mobile-only', 'task-1'],
            rewardedSubtaskIds: ['subtask-1'],
            habitBonusDates: ['2026-07-02', '2026-07-03'],
        });
        expect(snapshot.activeTitle).toBeNull();
        expect(snapshot.debuff).toEqual({ active: false, expiresAt: null });
        expect(snapshot.battleProgress).toEqual({
            battleUnlocked: false,
            currentStage: 1,
            maxClearedStage: 0,
        });
    });

    it('不正なWeb固有状態を既定値へ戻す', () => {
        const snapshot = sanitizeCanonicalGameSnapshot({
            character: { totalXp: 0 },
            activeTitle: '   ',
            debuff: { active: true, expiresAt: 'invalid' },
            battleProgress: {
                battleUnlocked: 'yes',
                currentStage: -10,
                maxClearedStage: Number.NaN,
                logs: [{ message: '同期対象外' }],
            },
        });

        expect(snapshot.activeTitle).toBeNull();
        expect(snapshot.debuff).toEqual({ active: false, expiresAt: null });
        expect(snapshot.battleProgress).toEqual({
            battleUnlocked: false,
            currentStage: 1,
            maxClearedStage: 0,
        });
    });

    it('正規形式を再sanitizeしても同じ内容を維持する', () => {
        const first = convertLegacyGameSnapshot({
            game: {
                character: { name: '勇者', avatar: 'male', totalXp: 30 },
                rewardLedger: {
                    rewardedTaskIds: ['task-1'],
                    rewardedSubtaskIds: ['subtask-1'],
                    habitBonusDates: ['2026-07-02'],
                },
                activeTitle: '成長の第一歩',
                debuff: { active: true, expiresAt: '2026-07-04T00:00:00.000Z' },
                battleProgress: { battleUnlocked: true, currentStage: 2, maxClearedStage: 1 },
            },
        });

        expect(sanitizeCanonicalGameSnapshot(first)).toEqual(first);
    });
});
