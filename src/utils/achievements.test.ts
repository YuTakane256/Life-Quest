import { describe, expect, it } from 'vitest';
import { getAchievementProgress, getUnlockedTitles, type AchievementSnapshot } from './achievements';
import type { AchievementDefinition } from '../config/achievements';

const definitions: AchievementDefinition[] = [
    {
        id: 'xp',
        title: 'XP',
        description: 'XP target',
        icon: 'x',
        metric: 'totalXp',
        target: 100,
        rewardTitle: 'XP Master',
    },
    {
        id: 'stage',
        title: 'Stage',
        description: 'Stage target',
        icon: 's',
        metric: 'maxStage',
        target: 10,
        rewardTitle: 'Stage Master',
    },
];

const baseSnapshot: AchievementSnapshot = {
    totalXp: 0,
    activeDays: 0,
    perfectDays: 0,
    maxStage: 0,
    equipmentCount: 0,
};

describe('achievement helpers', () => {
    it('calculates locked and unlocked progress from a snapshot', () => {
        const progress = getAchievementProgress({ ...baseSnapshot, totalXp: 50, maxStage: 10 }, definitions);

        expect(progress[0]).toMatchObject({
            id: 'xp',
            current: 50,
            progress: 0.5,
            unlocked: false,
        });
        expect(progress[1]).toMatchObject({
            id: 'stage',
            current: 10,
            progress: 1,
            unlocked: true,
        });
    });

    it('clamps progress at 1 and treats negative snapshot values as 0', () => {
        const progress = getAchievementProgress({ ...baseSnapshot, totalXp: 250, maxStage: -5 }, definitions);

        expect(progress[0].progress).toBe(1);
        expect(progress[0].unlocked).toBe(true);
        expect(progress[1].current).toBe(0);
        expect(progress[1].progress).toBe(0);
        expect(progress[1].unlocked).toBe(false);
    });

    it('returns unlocked reward titles in definition order', () => {
        const progress = getAchievementProgress({ ...baseSnapshot, totalXp: 100, maxStage: 12 }, definitions);

        expect(getUnlockedTitles(progress)).toEqual(['XP Master', 'Stage Master']);
    });

    it('deduplicates achievement definitions by id', () => {
        const progress = getAchievementProgress({ ...baseSnapshot, totalXp: 100, maxStage: 10 }, [
            definitions[0],
            { ...definitions[0], title: 'Duplicate XP', target: 1, rewardTitle: 'Duplicate' },
            definitions[1],
        ]);

        expect(progress.map((achievement) => achievement.id)).toEqual(['xp', 'stage']);
        expect(getUnlockedTitles(progress)).toEqual(['XP Master', 'Stage Master']);
    });

    it('treats unknown metrics and non-positive targets as safe values', () => {
        const malformedDefinition = {
            ...definitions[0],
            id: 'broken',
            metric: 'missingMetric' as never,
            target: 0,
            rewardTitle: 'Broken',
        };

        const [progress] = getAchievementProgress({ ...baseSnapshot, totalXp: 100 }, [malformedDefinition]);

        expect(progress).toMatchObject({
            id: 'broken',
            current: 0,
            progress: 0,
            unlocked: false,
        });
    });

    it('keeps progress finite for non-finite and fractional values', () => {
        const malformedDefinitions: AchievementDefinition[] = [
            { ...definitions[0], id: 'nan-target', target: Number.NaN },
            { ...definitions[1], id: 'fractional-target', target: 10.9 },
        ];

        const progress = getAchievementProgress({
            ...baseSnapshot,
            totalXp: Number.POSITIVE_INFINITY,
            maxStage: 10.9,
        }, malformedDefinitions);

        expect(progress[0]).toMatchObject({
            id: 'nan-target',
            current: 0,
            progress: 0,
            unlocked: false,
        });
        expect(progress[1]).toMatchObject({
            id: 'fractional-target',
            current: 10,
            progress: 1,
            unlocked: true,
        });
    });
});
