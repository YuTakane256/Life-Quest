import type { BackupData } from './dataBackup';

export interface BackupImportSummary {
    exportedAt: string;
    taskCount: number;
    habitCount: number;
    habitRecordCount: number;
    equipmentCount: number;
    unopenedChestCount: number;
    openedChestCount: number;
    taskXpDayCount: number;
    habitLogDayCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function getPersistedState(value: unknown): Record<string, unknown> {
    const record = asRecord(value);
    if (!record) return {};

    const state = asRecord(record.state);
    return state ?? record;
}

function getArrayLength(record: Record<string, unknown>, key: string): number {
    const value = record[key];
    return Array.isArray(value) ? value.length : 0;
}

function getRecordLength(record: Record<string, unknown>, key: string): number {
    const value = asRecord(record[key]);
    return value ? Object.keys(value).length : 0;
}

export function createBackupImportSummary(data: BackupData): BackupImportSummary {
    const tasks = getPersistedState(data.tasks);
    const habits = getPersistedState(data.habits);
    const game = getPersistedState(data.game);
    const stats = getPersistedState(data.stats);
    const chestQueue = Array.isArray(game.chestQueue) ? game.chestQueue : [];

    return {
        exportedAt: data.exportedAt,
        taskCount: getArrayLength(tasks, 'tasks'),
        habitCount: getArrayLength(habits, 'habits'),
        habitRecordCount: getArrayLength(habits, 'dailyRecords'),
        equipmentCount: getArrayLength(game, 'equipment'),
        unopenedChestCount: chestQueue.filter((chest) => asRecord(chest)?.opened === false).length,
        openedChestCount: chestQueue.filter((chest) => asRecord(chest)?.opened === true).length,
        taskXpDayCount: getRecordLength(stats, 'taskXpLog'),
        habitLogDayCount: getRecordLength(stats, 'habitLog'),
    };
}

export function formatBackupExportedAt(exportedAt: string): string {
    const date = new Date(exportedAt);
    if (Number.isNaN(date.getTime())) return '不明';

    return new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}
