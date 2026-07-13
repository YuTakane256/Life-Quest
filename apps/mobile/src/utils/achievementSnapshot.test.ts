import { describe, expect, it } from 'vitest';
import { buildAchievementSnapshot } from './achievementSnapshot';

describe('buildAchievementSnapshot', () => {
    it('activeDaysはtaskXpLogで正のXPを持つ日数（Webと同一セマンティクス）', () => {
        const snapshot = buildAchievementSnapshot({
            taskXpLog: { '2026-07-01': 40, '2026-07-02': 20, '2026-07-03': 0 },
            habitLog: {},
            totalXp: 0, maxStage: 0, equipmentCount: 0,
        });
        expect(snapshot.activeDays).toBe(2); // 0の日はactiveDaysに含まれない
    });

    it('activeDaysはタスクが削除されてもログが残っていれば減らない', () => {
        // taskXpLogは追記専用ログのため、tasks配列の増減に依存しない
        const snapshot = buildAchievementSnapshot({
            taskXpLog: { '2026-07-01': 30 },
            habitLog: {},
            totalXp: 0, maxStage: 0, equipmentCount: 0,
        });
        expect(snapshot.activeDays).toBe(1);
    });

    it('perfectDaysはhabitLogのallComplete日数（Webと同一セマンティクス）', () => {
        const snapshot = buildAchievementSnapshot({
            taskXpLog: {},
            habitLog: {
                '2026-07-01': { count: 2, allComplete: true },
                '2026-07-02': { count: 1, allComplete: false },
            },
            totalXp: 0, maxStage: 0, equipmentCount: 0,
        });
        expect(snapshot.perfectDays).toBe(1);
    });

    it('totalXp/maxStage/equipmentCountはそのまま透過する', () => {
        const snapshot = buildAchievementSnapshot({
            taskXpLog: {}, habitLog: {}, totalXp: 500, maxStage: 12, equipmentCount: 7,
        });
        expect(snapshot).toMatchObject({ totalXp: 500, maxStage: 12, equipmentCount: 7 });
    });

    it('ログが空でも安全に0を返す', () => {
        const snapshot = buildAchievementSnapshot({
            taskXpLog: {}, habitLog: {}, totalXp: 0, maxStage: 0, equipmentCount: 0,
        });
        expect(snapshot).toEqual({ totalXp: 0, activeDays: 0, perfectDays: 0, maxStage: 0, equipmentCount: 0 });
    });
});
