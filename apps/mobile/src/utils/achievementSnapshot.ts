/**
 * Mobile統計画面向けの実績スナップショット構築（#513）。
 *
 * Web `StatsPage.tsx` の算出（`activeDays` = XPを獲得した日数、
 * `perfectDays` = 全習慣達成日数）と同一セマンティクスを、Mobileが実際に
 * 保持しているローカルコレクション（tasks/habits/records）から導出する。
 * Webは永続化されたtaskXpLog/habitLogから集計するが、Mobileは
 * @life-quest/core/stats の buildTaskXpByDate/buildHabitActivityByDate が
 * tasks/records から同じ形の日別集計を再構築できるため、同じ入力ソースとして扱える。
 */
import { buildHabitActivityByDate, buildTaskXpByDate } from '@life-quest/core/stats';
import type { AchievementSnapshot } from '@life-quest/core/achievements';
import type { Habit, HabitDailyRecord } from '@life-quest/core/habits';
import type { Task } from '@life-quest/core/tasks';

export interface AchievementSnapshotInput {
    tasks: readonly Task[];
    habits: readonly Habit[];
    records: readonly HabitDailyRecord[];
    totalXp: number;
    maxStage: number;
    equipmentCount: number;
}

export function buildAchievementSnapshot(input: AchievementSnapshotInput): AchievementSnapshot {
    const taskXpByDate = buildTaskXpByDate(input.tasks);
    const habitActivity = buildHabitActivityByDate(input.habits, input.records);

    return {
        totalXp: input.totalXp,
        activeDays: Object.keys(taskXpByDate).length,
        perfectDays: Object.values(habitActivity).filter((day) => day.allComplete).length,
        maxStage: input.maxStage,
        equipmentCount: input.equipmentCount,
    };
}
