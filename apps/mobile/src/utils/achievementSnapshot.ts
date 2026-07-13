/**
 * Mobile統計画面向けの実績スナップショット構築（#513、統計ログ導入で改訂）。
 *
 * Web `StatsPage.tsx` の算出（`activeDays` = XPを獲得した日数、
 * `perfectDays` = 全習慣達成日数）と同一セマンティクスで、永続化された
 * 統計ログ（taskXpLog/habitLog）から導出する。
 *
 * 以前はtasks/habits/recordsから毎回再構築していたが、それだと完了記録の
 * 削除でactiveDaysが減ってしまいWebと挙動が異なっていた（Webは永続ログを
 * 使うため削除の影響を受けない）。useMobileStatsStore導入によりMobileも
 * 同じログベースの算出に揃えた。
 */
import type { AchievementSnapshot } from '@life-quest/core/achievements';
import type { HabitLog, TaskXpLog } from '@life-quest/core/statsLog';

export interface AchievementSnapshotInput {
    taskXpLog: TaskXpLog;
    habitLog: HabitLog;
    totalXp: number;
    maxStage: number;
    equipmentCount: number;
}

export function buildAchievementSnapshot(input: AchievementSnapshotInput): AchievementSnapshot {
    return {
        totalXp: input.totalXp,
        activeDays: Object.values(input.taskXpLog).filter((xp) => xp > 0).length,
        perfectDays: Object.values(input.habitLog).filter((day) => day.allComplete).length,
        maxStage: input.maxStage,
        equipmentCount: input.equipmentCount,
    };
}
