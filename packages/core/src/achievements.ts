import { nonNegativeInteger, positiveInteger } from './numeric.ts';

export type AchievementMetric = 'totalXp' | 'activeDays' | 'perfectDays' | 'maxStage' | 'equipmentCount';

export interface AchievementDefinition {
    id: string;
    title: string;
    description: string;
    icon: string;
    metric: AchievementMetric;
    target: number;
    rewardTitle: string;
}

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
    {
        id: 'first_level_up',
        title: '成長の第一歩',
        description: '累計XPを30獲得する',
        icon: '⚡',
        metric: 'totalXp',
        target: 30,
        rewardTitle: '駆け出し冒険者',
    },
    {
        id: 'steady_worker',
        title: '継続の火種',
        description: 'XPを獲得した日を7日作る',
        icon: '🔥',
        metric: 'activeDays',
        target: 7,
        rewardTitle: '習慣の芽',
    },
    {
        id: 'habit_keeper',
        title: '整った一日',
        description: '全習慣達成日を3日作る',
        icon: '🌟',
        metric: 'perfectDays',
        target: 3,
        rewardTitle: '整えし者',
    },
    {
        id: 'map_challenger',
        title: 'マップ踏破者',
        description: 'ステージ5を突破する',
        icon: '🗺️',
        metric: 'maxStage',
        target: 5,
        rewardTitle: '草原の挑戦者',
    },
    {
        id: 'gear_collector',
        title: '装備コレクター',
        description: '装備を10個集める',
        icon: '🎒',
        metric: 'equipmentCount',
        target: 10,
        rewardTitle: '収集家',
    },
    {
        id: 'castle_breaker',
        title: '古城を越えて',
        description: 'ステージ20を突破する',
        icon: '🏰',
        metric: 'maxStage',
        target: 20,
        rewardTitle: '古城の勝者',
    },
] as const;

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
