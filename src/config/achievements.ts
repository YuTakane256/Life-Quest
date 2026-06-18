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
