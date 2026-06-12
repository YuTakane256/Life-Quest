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
    notifications: {},
    loginBonus: {},
    battleHistory: {},
    taskSort: {},
    habitSort: {},
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
            expect(isValidBackup({ ...validBackup, notifications: [] })).toBe(false);
            expect(isValidBackup({ ...validBackup, battleHistory: [] })).toBe(false);
        });

        it('allows optional settings stores to be omitted', () => {
            const { theme, notifications, loginBonus, battleHistory, taskSort, habitSort, ...withoutOptionalStores } = validBackup;
            expect(theme).toEqual({});
            expect(notifications).toEqual({});
            expect(loginBonus).toEqual({});
            expect(battleHistory).toEqual({});
            expect(taskSort).toEqual({});
            expect(habitSort).toEqual({});
            expect(isValidBackup(withoutOptionalStores)).toBe(true);
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
            localStorage.setItem('quest-board-notifications', '{"state":{"enabled":true}}');
            localStorage.setItem('quest-board-login-bonus', '{"state":{"streak":3}}');
            localStorage.setItem('quest-board-battle-history', '{"state":{"history":[]}}');
            localStorage.setItem('quest-board-task-sort', '{"state":{"sortMode":"priority"}}');
            localStorage.setItem('quest-board-habit-sort', '{"state":{"sortMode":"streak"}}');

            expect(exportAllData()).toEqual({
                version: BACKUP_VERSION,
                exportedAt: '2026-02-03T04:05:06.000Z',
                tasks: { state: { tasks: [] } },
                habits: { state: { habits: [] } },
                game: { state: { character: { level: 2 } } },
                stats: { state: { taskXpLog: {} } },
                theme: { state: { mode: 'dark' } },
                notifications: { state: { enabled: true } },
                loginBonus: { state: { streak: 3 } },
                battleHistory: { state: { history: [] } },
                taskSort: { state: { sortMode: 'priority' } },
                habitSort: { state: { sortMode: 'streak' } },
            });
        });

        it('imports backup data into the expected storage keys', () => {
            expect(importAllData(validBackup)).toBe(true);
            expect(JSON.parse(localStorage.getItem('quest-board-tasks') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-habits') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-game') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-stats') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-theme') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-notifications') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-login-bonus') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-battle-history') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-task-sort') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-habit-sort') || '{}')).toEqual({});
        });

        it('imports older backups that omit optional stores', () => {
            const { theme, notifications, loginBonus, battleHistory, taskSort, habitSort, ...legacyBackup } = validBackup;
            expect(theme).toEqual({});
            expect(notifications).toEqual({});
            expect(loginBonus).toEqual({});
            expect(battleHistory).toEqual({});
            expect(taskSort).toEqual({});
            expect(habitSort).toEqual({});

            expect(importAllData(legacyBackup)).toBe(true);
            expect(localStorage.getItem('quest-board-notifications')).toBeNull();
        });
    });
});
