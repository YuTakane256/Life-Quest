import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectSaveDataHealth, SAVE_DATA_SECTION_KEYS } from './saveDataHealth';

describe('inspectSaveDataHealth', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reports healthy, missing, and invalid sections', () => {
        localStorage.setItem('quest-board-tasks', '{"state":{"tasks":[]}}');
        localStorage.setItem('quest-board-habits', '{');
        localStorage.setItem('quest-board-game', '[]');
        localStorage.setItem('quest-board-stats', '{"state":{"taskXpLog":{},"habitLog":{}}}');

        const report = inspectSaveDataHealth(localStorage);

        expect(report.available).toBe(true);
        expect(report.healthyCount).toBeGreaterThanOrEqual(2);
        expect(report.invalidCount).toBe(2);
        expect(report.missingCount).toBeGreaterThan(0);
        expect(report.totalBytes).toBeGreaterThan(0);
        expect(report.sections.find((section) => section.key === 'quest-board-habits')?.status).toBe('invalid');
        expect(report.sections.find((section) => section.key === 'quest-board-theme')?.status).toBe('missing');
    });

    it('JSONオブジェクトでもZustand stateや必須フィールドがなければ破損扱いにする', () => {
        localStorage.setItem('quest-board-tasks', '{"other":{}}');
        localStorage.setItem('quest-board-stats', '{"state":{"taskXpLog":{}}}');

        const report = inspectSaveDataHealth(localStorage);

        expect(report.sections.find((section) => section.key === 'quest-board-tasks')?.status).toBe('invalid');
        expect(report.sections.find((section) => section.key === 'quest-board-stats')?.status).toBe('invalid');
    });

    it('全persistストアを診断対象に含める', () => {
        expect(inspectSaveDataHealth(localStorage).sections.map((section) => section.key)).toEqual(
            SAVE_DATA_SECTION_KEYS
        );
        expect(SAVE_DATA_SECTION_KEYS).toContain('quest-board-title');
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

    it('uses UTF-8 byte length for non-ASCII save data', () => {
        const value = '{"state":{"tasks":[{"name":"習慣"}]}}';
        localStorage.setItem('quest-board-tasks', value);

        const report = inspectSaveDataHealth(localStorage);
        const section = report.sections.find((candidate) => candidate.key === 'quest-board-tasks');

        expect(section?.byteLength).toBe(
            new TextEncoder().encode('quest-board-tasks').length + new TextEncoder().encode(value).length
        );
    });

    it('falls back to deterministic UTF-16 estimate without TextEncoder', () => {
        const value = '{"state":{"tasks":[{"name":"習慣"}]}}';
        vi.stubGlobal('TextEncoder', undefined);
        localStorage.setItem('quest-board-tasks', value);

        const report = inspectSaveDataHealth(localStorage);
        const section = report.sections.find((candidate) => candidate.key === 'quest-board-tasks');

        expect(section?.byteLength).toBe(('quest-board-tasks'.length + value.length) * 2);
    });
});
