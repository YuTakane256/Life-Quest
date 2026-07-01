import { utf8ByteLength } from './bytes';
import { getWebLocalStorage } from '../platform/storage';

export const BACKUP_VERSION = 1;
export const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_BACKUP_STRUCTURE_DEPTH = 64;
export const MAX_BACKUP_STRUCTURE_NODES = 100_000;
export const BACKUP_INTEGRITY_ALGORITHM = 'fnv1a-32';

export interface BackupIntegrity {
    algorithm: typeof BACKUP_INTEGRITY_ALGORITHM;
    checksum: string;
}

export interface BackupData {
    version: number;
    exportedAt: string;
    integrity?: BackupIntegrity;
    tasks: unknown;
    habits: unknown;
    game: unknown;
    stats: unknown;
    theme?: unknown;
    notifications?: unknown;
    loginBonus?: unknown;
    battleHistory?: unknown;
    taskSort?: unknown;
    habitSort?: unknown;
    title?: unknown;
    friends?: unknown;
    motion?: unknown;
}

export type BackupImportParseResult =
    | { ok: true; data: BackupData }
    | { ok: false; reason: 'file-too-large' | 'malformed-json' | 'invalid-backup' };

type BackupDataKey = keyof Omit<BackupData, 'version' | 'exportedAt' | 'integrity'>;

const BACKUP_STORAGE_SLOTS: Array<{ dataKey: BackupDataKey; storageKey: string }> = [
    { dataKey: 'tasks', storageKey: 'quest-board-tasks' },
    { dataKey: 'habits', storageKey: 'quest-board-habits' },
    { dataKey: 'game', storageKey: 'quest-board-game' },
    { dataKey: 'stats', storageKey: 'quest-board-stats' },
    { dataKey: 'theme', storageKey: 'quest-board-theme' },
    { dataKey: 'notifications', storageKey: 'quest-board-notifications' },
    { dataKey: 'loginBonus', storageKey: 'quest-board-login-bonus' },
    { dataKey: 'battleHistory', storageKey: 'quest-board-battle-history' },
    { dataKey: 'taskSort', storageKey: 'quest-board-task-sort' },
    { dataKey: 'habitSort', storageKey: 'quest-board-habit-sort' },
    { dataKey: 'title', storageKey: 'quest-board-title' },
    { dataKey: 'motion', storageKey: 'quest-board-motion' },
];

function normalizeForChecksum(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(normalizeForChecksum);
    }

    if (!isPlainObject(value)) {
        return value;
    }

    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .filter((key) => value[key] !== undefined)
            .map((key) => [key, normalizeForChecksum(value[key])])
    );
}

function getBackupChecksumPayload(data: BackupData): Omit<BackupData, 'integrity'> {
    const payload = { ...data };
    delete payload.integrity;
    return payload;
}

/**
 * Bounds work performed by validation and checksum normalization.
 * JSON cannot contain cycles, but direct callers can still pass cyclic objects.
 */
export function hasSafeBackupStructure(value: unknown): boolean {
    const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
    const seen = new WeakSet<object>();
    let nodeCount = 0;

    try {
        while (pending.length > 0) {
            const current = pending.pop();
            if (!current) break;

            nodeCount += 1;
            if (nodeCount > MAX_BACKUP_STRUCTURE_NODES) return false;
            if (current.depth > MAX_BACKUP_STRUCTURE_DEPTH) return false;

            if (typeof current.value !== 'object' || current.value === null) continue;
            if (seen.has(current.value)) return false;
            seen.add(current.value);

            const children = Array.isArray(current.value)
                ? current.value
                : Object.values(current.value);

            for (const child of children) {
                pending.push({ value: child, depth: current.depth + 1 });
            }
        }
    } catch {
        return false;
    }

    return true;
}

export function calculateBackupChecksum(data: BackupData): string {
    if (!hasSafeBackupStructure(data)) {
        throw new RangeError('Backup structure exceeds complexity limits');
    }
    const serialized = JSON.stringify(normalizeForChecksum(getBackupChecksumPayload(data)));
    let hash = 0x811c9dc5;

    for (let i = 0; i < serialized.length; i++) {
        hash ^= serialized.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function withBackupIntegrity(data: Omit<BackupData, 'integrity'>): BackupData {
    const backup: BackupData = { ...data };
    return {
        ...backup,
        integrity: {
            algorithm: BACKUP_INTEGRITY_ALGORITHM,
            checksum: calculateBackupChecksum(backup),
        },
    };
}

/** Plain object（配列・null は除く）かどうか */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** バックアップ JSON が想定する構造になっているか検証する型ガード */
export function isValidBackup(data: unknown): data is BackupData {
    if (!isPlainObject(data)) return false;
    if (!hasSafeBackupStructure(data)) return false;
    if (data.version !== BACKUP_VERSION) return false;
    if (typeof data.exportedAt !== 'string') return false;
    if (Number.isNaN(new Date(data.exportedAt).getTime())) return false;
    if (data.integrity !== undefined) {
        if (!isPlainObject(data.integrity)) return false;
        if (data.integrity.algorithm !== BACKUP_INTEGRITY_ALGORITHM) return false;
        if (typeof data.integrity.checksum !== 'string') return false;
        try {
            if (data.integrity.checksum !== calculateBackupChecksum(data as unknown as BackupData)) return false;
        } catch {
            return false;
        }
    }
    if (!isPlainObject(data.tasks)) return false;
    if (!isPlainObject(data.habits)) return false;
    if (!isPlainObject(data.game)) return false;
    if (!isPlainObject(data.stats)) return false;
    if (data.theme !== undefined && !isPlainObject(data.theme)) return false;
    if (data.notifications !== undefined && !isPlainObject(data.notifications)) return false;
    if (data.loginBonus !== undefined && !isPlainObject(data.loginBonus)) return false;
    if (data.battleHistory !== undefined && !isPlainObject(data.battleHistory)) return false;
    if (data.taskSort !== undefined && !isPlainObject(data.taskSort)) return false;
    if (data.habitSort !== undefined && !isPlainObject(data.habitSort)) return false;
    if (data.title !== undefined && !isPlainObject(data.title)) return false;
    if (data.friends !== undefined && !isPlainObject(data.friends)) return false;
    if (data.motion !== undefined && !isPlainObject(data.motion)) return false;
    return true;
}

/**
 * localStorage の値を安全に JSON.parse する。
 * 値が壊れている／DevTools 経由で書き換えられている場合でも、
 * エクスポート全体がクラッシュしないよう空オブジェクトでフォールバックする。
 */
export function safeParseStorage(key: string, storage: Storage | null = getWebLocalStorage()): unknown {
    try {
        return JSON.parse(storage?.getItem(key) || '{}');
    } catch {
        return {};
    }
}

export function parseBackupImportJson(text: string): BackupImportParseResult {
    if (utf8ByteLength(text) > MAX_IMPORT_FILE_SIZE) {
        return { ok: false, reason: 'file-too-large' };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, reason: 'malformed-json' };
    }

    if (!isValidBackup(parsed)) {
        return { ok: false, reason: 'invalid-backup' };
    }

    return { ok: true, data: parsed };
}

interface PreparedStorageWrite {
    storageKey: string;
    serializedValue: string | null;
}

function prepareStorageWrites(data: BackupData): PreparedStorageWrite[] | null {
    try {
        let totalBytes = 0;
        const writes = BACKUP_STORAGE_SLOTS.map(({ dataKey, storageKey }) => {
            const value = data[dataKey];
            const serializedValue = value === undefined ? null : JSON.stringify(value);
            totalBytes += utf8ByteLength(storageKey);
            if (serializedValue !== null) totalBytes += utf8ByteLength(serializedValue);
            return { storageKey, serializedValue };
        });
        return totalBytes <= MAX_IMPORT_FILE_SIZE ? writes : null;
    } catch {
        return null;
    }
}

export function exportAllData(storage: Storage | null = getWebLocalStorage()): BackupData {
    return withBackupIntegrity({
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        tasks: safeParseStorage('quest-board-tasks', storage),
        habits: safeParseStorage('quest-board-habits', storage),
        game: safeParseStorage('quest-board-game', storage),
        stats: safeParseStorage('quest-board-stats', storage),
        theme: safeParseStorage('quest-board-theme', storage),
        notifications: safeParseStorage('quest-board-notifications', storage),
        loginBonus: safeParseStorage('quest-board-login-bonus', storage),
        battleHistory: safeParseStorage('quest-board-battle-history', storage),
        taskSort: safeParseStorage('quest-board-task-sort', storage),
        habitSort: safeParseStorage('quest-board-habit-sort', storage),
        title: safeParseStorage('quest-board-title', storage),
        motion: safeParseStorage('quest-board-motion', storage),
    });
}

function restoreStorageSnapshot(snapshot: Map<string, string | null>, storage: Storage) {
    for (const [key, value] of snapshot) {
        if (value === null) {
            storage.removeItem(key);
        } else {
            storage.setItem(key, value);
        }
    }
}

export function importAllData(data: BackupData, storage: Storage | null = getWebLocalStorage()): boolean {
    if (!isValidBackup(data)) return false;
    if (!storage) return false;
    const writes = prepareStorageWrites(data);
    if (!writes) return false;

    let snapshot: Map<string, string | null>;
    try {
        snapshot = new Map(
            writes.map(({ storageKey }) => [storageKey, storage.getItem(storageKey)] as const)
        );
    } catch {
        return false;
    }

    try {
        for (const { storageKey, serializedValue } of writes) {
            if (serializedValue === null) {
                storage.removeItem(storageKey);
            } else {
                storage.setItem(storageKey, serializedValue);
            }
        }
        return true;
    } catch {
        try {
            restoreStorageSnapshot(snapshot, storage);
        } catch {
            // Best-effort rollback: the import still reports failure if storage remains unavailable.
        }
        return false;
    }
}
