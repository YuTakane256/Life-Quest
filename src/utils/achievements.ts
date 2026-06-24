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
    return typeof metric === 'string' && metric in snapshot
        ? snapshot[metric as keyof AchievementSnapshot]
        : 0;
}

function nonNegativeInteger(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function positiveInteger(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export function getAchievementProgress(
    snapshot: AchievementSnapshot,
    definitions: readonly AchievementDefinition[] = ACHIEVEMENTS
): AchievementProgress[] {
    const seenIds = new Set<string>();

    return definitions.filter((definition) => {
        if (seenIds.has(definition.id)) return false;
        seenIds.add(definition.id);
        return true;
    }).map((definition) => {
        const current = nonNegativeInteger(getMetricValue(snapshot, definition.metric));
        const target = positiveInteger(definition.target);
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
