import { ACHIEVEMENTS, type AchievementDefinition, type AchievementMetric } from '../config/achievements';

export interface AchievementSnapshot {
    totalXp: number;
    activeDays: number;
    perfectDays: number;
    maxStage: number;
    equipmentCount: number;
}

export interface AchievementProgress extends AchievementDefinition {
    current: number;
    progress: number;
    unlocked: boolean;
}

function getMetricValue(snapshot: AchievementSnapshot, metric: AchievementMetric): number {
    return snapshot[metric];
}

export function getAchievementProgress(
    snapshot: AchievementSnapshot,
    definitions: readonly AchievementDefinition[] = ACHIEVEMENTS
): AchievementProgress[] {
    return definitions.map((definition) => {
        const current = Math.max(0, getMetricValue(snapshot, definition.metric));
        const target = Math.max(1, definition.target);
        const progress = Math.min(1, current / target);
        return {
            ...definition,
            current,
            progress,
            unlocked: current >= target,
        };
    });
}

export function getUnlockedTitles(progress: readonly AchievementProgress[]): string[] {
    return progress
        .filter((achievement) => achievement.unlocked)
        .map((achievement) => achievement.rewardTitle);
}
