import { describe, expect, it } from 'vitest';
import { createBackupImportSummary, formatBackupExportedAt } from './backupSummary';
import type { BackupData } from './dataBackup';

function makeBackup(overrides: Partial<BackupData> = {}): BackupData {
    return {
        version: 1,
        exportedAt: '2026-06-22T00:00:00.000Z',
        tasks: { state: { tasks: [{ id: 'task-1' }, { id: 'task-2' }] } },
        habits: { state: { habits: [{ id: 'habit-1' }], dailyRecords: [{ id: 'record-1' }] } },
        game: {
            state: {
                equipment: [{ id: 'item-1' }],
                chestQueue: [{ opened: false }, { opened: true }, { opened: false }],
            },
        },
        stats: { state: { taskXpLog: { '2026-06-21': 10 }, habitLog: { '2026-06-21': { count: 1 } } } },
        ...overrides,
    };
}

describe('createBackupImportSummary', () => {
    it('counts key records from persisted Zustand backup sections', () => {
        expect(createBackupImportSummary(makeBackup())).toEqual({
            exportedAt: '2026-06-22T00:00:00.000Z',
            taskCount: 2,
            habitCount: 1,
            habitRecordCount: 1,
            equipmentCount: 1,
            unopenedChestCount: 2,
            openedChestCount: 1,
            taskXpDayCount: 1,
            habitLogDayCount: 1,
        });
    });

    it('falls back to zero counts for malformed optional shapes', () => {
        const summary = createBackupImportSummary(makeBackup({
            tasks: { state: { tasks: 'broken' } },
            habits: { state: null },
            game: { state: { chestQueue: [{ opened: 'yes' }] } },
            stats: { state: { taskXpLog: [], habitLog: null } },
        }));

        expect(summary.taskCount).toBe(0);
        expect(summary.habitCount).toBe(0);
        expect(summary.habitRecordCount).toBe(0);
        expect(summary.equipmentCount).toBe(0);
        expect(summary.unopenedChestCount).toBe(0);
        expect(summary.openedChestCount).toBe(0);
        expect(summary.taskXpDayCount).toBe(0);
        expect(summary.habitLogDayCount).toBe(0);
    });
});

describe('formatBackupExportedAt', () => {
    it('formats valid dates and guards invalid dates', () => {
        expect(formatBackupExportedAt('2026-06-22T00:00:00.000Z')).not.toBe('');
        expect(formatBackupExportedAt('not-a-date')).toBe('不明');
    });
});
