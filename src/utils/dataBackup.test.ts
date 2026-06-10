import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BACKUP_VERSION,
    exportAllData,
    importAllData,
    isPlainObject,
    isValidBackup,
    safeParseStorage,
    type BackupData,
} from './dataBackup';

const validBackup: BackupData = {
    version: BACKUP_VERSION,
    exportedAt: '2026-01-01T00:00:00.000Z',
    tasks: {},
    habits: {},
    game: {},
    stats: {},
    theme: {},
};

describe('dataBackup utilities', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useRealTimers();
    });

    describe('isPlainObject', () => {
        it('accepts plain objects only', () => {
            expect(isPlainObject({})).toBe(true);
            expect(isPlainObject({ a: 1 })).toBe(true);
            expect(isPlainObject(null)).toBe(false);
            expect(isPlainObject([])).toBe(false);
            expect(isPlainObject('object')).toBe(false);
        });
    });

    describe('isValidBackup', () => {
        it('accepts a valid backup payload', () => {
            expect(isValidBackup(validBackup)).toBe(true);
        });

        it('rejects invalid version and exportedAt values', () => {
            expect(isValidBackup({ ...validBackup, version: BACKUP_VERSION + 1 })).toBe(false);
            expect(isValidBackup({ ...validBackup, exportedAt: 'not-a-date' })).toBe(false);
        });

        it('rejects missing store objects and array-shaped stores', () => {
            expect(isValidBackup({ ...validBackup, tasks: undefined })).toBe(false);
            expect(isValidBackup({ ...validBackup, habits: [] })).toBe(false);
            expect(isValidBackup({ ...validBackup, theme: [] })).toBe(false);
        });

        it('allows theme to be omitted', () => {
            const { theme, ...withoutTheme } = validBackup;
            expect(theme).toEqual({});
            expect(isValidBackup(withoutTheme)).toBe(true);
        });
    });

    describe('safeParseStorage', () => {
        it('parses valid JSON from localStorage', () => {
            localStorage.setItem('key', '{"hello":"world"}');
            expect(safeParseStorage('key')).toEqual({ hello: 'world' });
        });

        it('falls back to an empty object for missing or malformed values', () => {
            expect(safeParseStorage('missing')).toEqual({});
            localStorage.setItem('broken', '{');
            expect(safeParseStorage('broken')).toEqual({});
        });
    });

    describe('exportAllData / importAllData', () => {
        it('exports all persisted store buckets', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-02-03T04:05:06.000Z'));
            localStorage.setItem('quest-board-tasks', '{"state":{"tasks":[]}}');
            localStorage.setItem('quest-board-habits', '{"state":{"habits":[]}}');
            localStorage.setItem('quest-board-game', '{"state":{"character":{"level":2}}}');
            localStorage.setItem('quest-board-stats', '{"state":{"taskXpLog":{}}}');
            localStorage.setItem('quest-board-theme', '{"state":{"mode":"dark"}}');

            expect(exportAllData()).toEqual({
                version: BACKUP_VERSION,
                exportedAt: '2026-02-03T04:05:06.000Z',
                tasks: { state: { tasks: [] } },
                habits: { state: { habits: [] } },
                game: { state: { character: { level: 2 } } },
                stats: { state: { taskXpLog: {} } },
                theme: { state: { mode: 'dark' } },
            });
        });

        it('imports backup data into the expected storage keys', () => {
            expect(importAllData(validBackup)).toBe(true);
            expect(JSON.parse(localStorage.getItem('quest-board-tasks') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-habits') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-game') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-stats') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-theme') || '{}')).toEqual({});
        });
    });
});
