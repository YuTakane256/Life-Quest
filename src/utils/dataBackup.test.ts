import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BACKUP_VERSION,
    MAX_IMPORT_FILE_SIZE,
    exportAllData,
    importAllData,
    isPlainObject,
    isValidBackup,
    parseBackupImportJson,
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
    title: {},
    friends: {},
    motion: {},
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
            const { theme, notifications, loginBonus, battleHistory, taskSort, habitSort, title, friends, motion, ...withoutOptionalStores } = validBackup;
            expect(theme).toEqual({});
            expect(notifications).toEqual({});
            expect(loginBonus).toEqual({});
            expect(battleHistory).toEqual({});
            expect(taskSort).toEqual({});
            expect(habitSort).toEqual({});
            expect(title).toEqual({});
            expect(friends).toEqual({});
            expect(motion).toEqual({});
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

    describe('parseBackupImportJson', () => {
        it('valid backup JSON を BackupData として返す', () => {
            expect(parseBackupImportJson(JSON.stringify(validBackup))).toEqual({
                ok: true,
                data: validBackup,
            });
        });

        it('壊れた JSON は malformed-json として返す', () => {
            expect(parseBackupImportJson('{')).toEqual({
                ok: false,
                reason: 'malformed-json',
            });
        });

        it('JSONとしては読めてもバックアップ形式でなければ invalid-backup として返す', () => {
            expect(parseBackupImportJson(JSON.stringify({ ...validBackup, version: BACKUP_VERSION + 1 }))).toEqual({
                ok: false,
                reason: 'invalid-backup',
            });
        });

        it('UTF-8で上限を超える入力はJSON.parse前に拒否する', () => {
            expect(parseBackupImportJson('あ'.repeat(Math.floor(MAX_IMPORT_FILE_SIZE / 3) + 1))).toEqual({
                ok: false,
                reason: 'file-too-large',
            });
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
            localStorage.setItem('quest-board-title', '{"state":{"activeTitle":"収集家"}}');
            localStorage.setItem('quest-board-friends', '{"state":{"friends":[]}}');
            localStorage.setItem('quest-board-motion', '{"state":{"mode":"reduced"}}');

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
                title: { state: { activeTitle: '収集家' } },
                friends: { state: { friends: [] } },
                motion: { state: { mode: 'reduced' } },
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
            expect(JSON.parse(localStorage.getItem('quest-board-title') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-friends') || '{}')).toEqual({});
            expect(JSON.parse(localStorage.getItem('quest-board-motion') || '{}')).toEqual({});
        });

        it('rejects malformed runtime payloads before touching storage', () => {
            localStorage.setItem('quest-board-tasks', '{"state":{"tasks":["old"]}}');
            localStorage.setItem('quest-board-theme', '{"state":{"mode":"dark"}}');

            const malformedPayload = {
                ...validBackup,
                tasks: [],
                theme: { state: { mode: 'light' } },
            } as unknown as BackupData;

            expect(importAllData(malformedPayload)).toBe(false);
            expect(localStorage.getItem('quest-board-tasks')).toBe('{"state":{"tasks":["old"]}}');
            expect(localStorage.getItem('quest-board-theme')).toBe('{"state":{"mode":"dark"}}');
        });

        it('巨大runtime payloadはstorage変更前に拒否する', () => {
            localStorage.setItem('quest-board-tasks', '{"state":{"tasks":["old"]}}');
            const oversized = {
                ...validBackup,
                tasks: { payload: 'x'.repeat(MAX_IMPORT_FILE_SIZE) },
            };

            expect(importAllData(oversized)).toBe(false);
            expect(localStorage.getItem('quest-board-tasks')).toBe('{"state":{"tasks":["old"]}}');
        });

        it('循環参照を含むruntime payloadはstorage変更前に拒否する', () => {
            localStorage.setItem('quest-board-tasks', '{"state":{"tasks":["old"]}}');
            const circular: Record<string, unknown> = {};
            circular.self = circular;

            expect(importAllData({ ...validBackup, tasks: circular })).toBe(false);
            expect(localStorage.getItem('quest-board-tasks')).toBe('{"state":{"tasks":["old"]}}');
        });

        it('imports older backups that omit optional stores', () => {
            const { theme, notifications, loginBonus, battleHistory, taskSort, habitSort, title, friends, motion, ...legacyBackup } = validBackup;
            expect(theme).toEqual({});
            expect(notifications).toEqual({});
            expect(loginBonus).toEqual({});
            expect(battleHistory).toEqual({});
            expect(taskSort).toEqual({});
            expect(habitSort).toEqual({});
            expect(title).toEqual({});
            expect(friends).toEqual({});
            expect(motion).toEqual({});

            localStorage.setItem('quest-board-theme', '{"state":{"mode":"dark"}}');
            localStorage.setItem('quest-board-notifications', '{"state":{"enabled":true}}');
            localStorage.setItem('quest-board-login-bonus', '{"state":{"streak":3}}');
            localStorage.setItem('quest-board-battle-history', '{"state":{"history":[{"id":"old"}]}}');
            localStorage.setItem('quest-board-task-sort', '{"state":{"sortMode":"priority"}}');
            localStorage.setItem('quest-board-habit-sort', '{"state":{"sortMode":"streak"}}');
            localStorage.setItem('quest-board-title', '{"state":{"activeTitle":"old"}}');
            localStorage.setItem('quest-board-friends', '{"state":{"friends":[{"id":"old"}]}}');
            localStorage.setItem('quest-board-motion', '{"state":{"mode":"reduced"}}');

            expect(importAllData(legacyBackup)).toBe(true);
            expect(localStorage.getItem('quest-board-theme')).toBeNull();
            expect(localStorage.getItem('quest-board-notifications')).toBeNull();
            expect(localStorage.getItem('quest-board-login-bonus')).toBeNull();
            expect(localStorage.getItem('quest-board-battle-history')).toBeNull();
            expect(localStorage.getItem('quest-board-task-sort')).toBeNull();
            expect(localStorage.getItem('quest-board-habit-sort')).toBeNull();
            expect(localStorage.getItem('quest-board-title')).toBeNull();
            expect(localStorage.getItem('quest-board-friends')).toBeNull();
            expect(localStorage.getItem('quest-board-motion')).toBeNull();
        });

        it('rolls back all touched keys if an import write fails', () => {
            localStorage.setItem('quest-board-tasks', '{"state":{"tasks":["old"]}}');
            localStorage.setItem('quest-board-habits', '{"state":{"habits":["old"]}}');
            localStorage.setItem('quest-board-game', '{"state":{"character":{"level":1}}}');
            localStorage.setItem('quest-board-stats', '{"state":{"taskXpLog":{"2026-01-01":10}}}');
            localStorage.setItem('quest-board-theme', '{"state":{"mode":"dark"}}');

            const before = new Map(
                [
                    'quest-board-tasks',
                    'quest-board-habits',
                    'quest-board-game',
                    'quest-board-stats',
                    'quest-board-theme',
                    'quest-board-notifications',
                ].map((key) => [key, localStorage.getItem(key)] as const)
            );

            const originalSetItem = Storage.prototype.setItem;
            let thrown = false;
            vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItemWithOneFailure(this: Storage, key, value) {
                if (key === 'quest-board-stats' && !thrown) {
                    thrown = true;
                    throw new Error('quota exceeded');
                }
                return originalSetItem.call(this, key, value);
            });

            expect(importAllData({
                ...validBackup,
                tasks: { state: { tasks: ['new'] } },
                habits: { state: { habits: ['new'] } },
                game: { state: { character: { level: 99 } } },
                stats: { state: { taskXpLog: {} } },
                notifications: { state: { enabled: true } },
            })).toBe(false);

            for (const [key, value] of before) {
                expect(localStorage.getItem(key)).toBe(value);
            }
        });
    });
});
