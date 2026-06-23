import { beforeEach, describe, expect, it } from 'vitest';
import { inspectSaveDataHealth } from './saveDataHealth';

describe('inspectSaveDataHealth', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('reports healthy, missing, and invalid sections', () => {
        localStorage.setItem('quest-board-tasks', '{"state":{"tasks":[]}}');
        localStorage.setItem('quest-board-habits', '{');
        localStorage.setItem('quest-board-game', '[]');
        localStorage.setItem('quest-board-stats', '{"state":{"taskXpLog":{}}}');

        const report = inspectSaveDataHealth(localStorage);

        expect(report.available).toBe(true);
        expect(report.healthyCount).toBeGreaterThanOrEqual(2);
        expect(report.invalidCount).toBe(2);
        expect(report.missingCount).toBeGreaterThan(0);
        expect(report.totalBytes).toBeGreaterThan(0);
        expect(report.sections.find((section) => section.key === 'quest-board-habits')?.status).toBe('invalid');
        expect(report.sections.find((section) => section.key === 'quest-board-theme')?.status).toBe('missing');
    });

    it('returns unavailable when storage access throws', () => {
        const brokenStorage = {
            getItem() {
                throw new Error('blocked');
            },
        } as unknown as Storage;

        expect(inspectSaveDataHealth(brokenStorage)).toEqual({
            available: false,
            sections: [],
            healthyCount: 0,
            missingCount: 0,
            invalidCount: 0,
            totalBytes: 0,
        });
    });

    it('returns unavailable without storage', () => {
        expect(inspectSaveDataHealth(null).available).toBe(false);
    });
});
