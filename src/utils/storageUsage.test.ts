import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyStorageUsage, formatStorageBytes, formatStorageUsageLevel, getAppStorageUsage } from './storageUsage';

describe('getAppStorageUsage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('counts only Life Quest storage keys', () => {
        localStorage.setItem('quest-board-tasks', '{"state":{"tasks":[]}}');
        localStorage.setItem('quest-board-theme', '{"state":{"mode":"dark"}}');
        localStorage.setItem('other-app', 'ignored');

        const usage = getAppStorageUsage(localStorage);

        expect(usage.available).toBe(true);
        expect(usage.itemCount).toBe(2);
        expect(usage.level).toBe('ok');
        expect(usage.bytes).toBe(
            new TextEncoder().encode('quest-board-tasks').length
            + new TextEncoder().encode('{"state":{"tasks":[]}}').length
            + new TextEncoder().encode('quest-board-theme').length
            + new TextEncoder().encode('{"state":{"mode":"dark"}}').length
        );
    });

    it('measures non-ASCII values with UTF-8 bytes when TextEncoder exists', () => {
        const value = '{"state":{"tasks":[{"name":"習慣🔥"}]}}';
        localStorage.setItem('quest-board-tasks', value);

        expect(getAppStorageUsage(localStorage).bytes).toBe(
            new TextEncoder().encode('quest-board-tasks').length + new TextEncoder().encode(value).length
        );
    });

    it('falls back to a deterministic UTF-16 estimate without TextEncoder', () => {
        const value = '{"state":{"tasks":[{"name":"習慣"}]}}';
        vi.stubGlobal('TextEncoder', undefined);
        localStorage.setItem('quest-board-tasks', value);

        expect(getAppStorageUsage(localStorage).bytes).toBe(('quest-board-tasks'.length + value.length) * 2);
    });

    it('returns unavailable when storage access throws', () => {
        const brokenStorage = {
            get length() {
                throw new Error('blocked');
            },
        } as unknown as Storage;

        expect(getAppStorageUsage(brokenStorage)).toEqual({
            available: false,
            bytes: 0,
            itemCount: 0,
            level: 'unavailable',
        });
    });

    it('returns unavailable without storage', () => {
        expect(getAppStorageUsage(null)).toEqual({
            available: false,
            bytes: 0,
            itemCount: 0,
            level: 'unavailable',
        });
    });
});

describe('classifyStorageUsage', () => {
    it('classifies storage pressure by byte thresholds', () => {
        expect(classifyStorageUsage(0)).toBe('ok');
        expect(classifyStorageUsage(1024 * 1024 - 1)).toBe('ok');
        expect(classifyStorageUsage(1024 * 1024)).toBe('warning');
        expect(classifyStorageUsage(4 * 1024 * 1024)).toBe('critical');
    });

    it('treats impossible byte values as unavailable', () => {
        expect(classifyStorageUsage(Number.NaN)).toBe('unavailable');
        expect(classifyStorageUsage(-1)).toBe('unavailable');
    });
});

describe('formatStorageBytes', () => {
    it('formats bytes, KB, and MB', () => {
        expect(formatStorageBytes(0)).toBe('0 B');
        expect(formatStorageBytes(512)).toBe('512 B');
        expect(formatStorageBytes(1536)).toBe('1.5 KB');
        expect(formatStorageBytes(2 * 1024 * 1024)).toBe('2.0 MB');
    });
});

describe('formatStorageUsageLevel', () => {
    it('formats storage usage levels for settings UI', () => {
        expect(formatStorageUsageLevel('ok')).toBe('OK');
        expect(formatStorageUsageLevel('warning')).toBe('注意');
        expect(formatStorageUsageLevel('critical')).toBe('危険');
        expect(formatStorageUsageLevel('unavailable')).toBe('利用不可');
    });
});
