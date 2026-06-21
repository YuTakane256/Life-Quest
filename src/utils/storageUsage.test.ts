import { beforeEach, describe, expect, it } from 'vitest';
import { formatStorageBytes, getAppStorageUsage } from './storageUsage';

describe('getAppStorageUsage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('counts only Life Quest storage keys', () => {
        localStorage.setItem('quest-board-tasks', '{"state":{"tasks":[]}}');
        localStorage.setItem('quest-board-theme', '{"state":{"mode":"dark"}}');
        localStorage.setItem('other-app', 'ignored');

        const usage = getAppStorageUsage(localStorage);

        expect(usage.available).toBe(true);
        expect(usage.itemCount).toBe(2);
        expect(usage.bytes).toBe(
            ('quest-board-tasks'.length + '{"state":{"tasks":[]}}'.length
                + 'quest-board-theme'.length + '{"state":{"mode":"dark"}}'.length) * 2
        );
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
        });
    });

    it('returns unavailable without storage', () => {
        expect(getAppStorageUsage(null)).toEqual({
            available: false,
            bytes: 0,
            itemCount: 0,
        });
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
