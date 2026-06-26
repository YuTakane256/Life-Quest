export const BACKUP_VERSION = 1;
export const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export interface BackupData {
    version: number;
    exportedAt: string;
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
}

type BackupDataKey = keyof Omit<BackupData, 'version' | 'exportedAt'>;

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
];

/** Plain object（配列・null は除く）かどうか */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** バックアップ JSON が想定する構造になっているか検証する型ガード */
export function isValidBackup(data: unknown): data is BackupData {
    if (!isPlainObject(data)) return false;
    if (data.version !== BACKUP_VERSION) return false;
    if (typeof data.exportedAt !== 'string') return false;
    if (Number.isNaN(new Date(data.exportedAt).getTime())) return false;
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
    return true;
}

/**
 * localStorage の値を安全に JSON.parse する。
 * 値が壊れている／DevTools 経由で書き換えられている場合でも、
 * エクスポート全体がクラッシュしないよう空オブジェクトでフォールバックする。
 */
export function safeParseStorage(key: string): unknown {
    try {
        return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
        return {};
    }
}

export function exportAllData(): BackupData {
    return {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        tasks: safeParseStorage('quest-board-tasks'),
        habits: safeParseStorage('quest-board-habits'),
        game: safeParseStorage('quest-board-game'),
        stats: safeParseStorage('quest-board-stats'),
        theme: safeParseStorage('quest-board-theme'),
        notifications: safeParseStorage('quest-board-notifications'),
        loginBonus: safeParseStorage('quest-board-login-bonus'),
        battleHistory: safeParseStorage('quest-board-battle-history'),
        taskSort: safeParseStorage('quest-board-task-sort'),
        habitSort: safeParseStorage('quest-board-habit-sort'),
        title: safeParseStorage('quest-board-title'),
    };
}

function restoreStorageSnapshot(snapshot: Map<string, string | null>) {
    for (const [key, value] of snapshot) {
        if (value === null) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, value);
        }
    }
}

export function importAllData(data: BackupData): boolean {
    if (!isValidBackup(data)) return false;

    const snapshot = new Map(
        BACKUP_STORAGE_SLOTS.map(({ storageKey }) => [storageKey, localStorage.getItem(storageKey)] as const)
    );

    try {
        for (const { dataKey, storageKey } of BACKUP_STORAGE_SLOTS) {
            const value = data[dataKey];
            if (value === undefined) {
                localStorage.removeItem(storageKey);
            } else {
                localStorage.setItem(storageKey, JSON.stringify(value));
            }
        }
        return true;
    } catch {
        try {
            restoreStorageSnapshot(snapshot);
        } catch {
            // Best-effort rollback: the import still reports failure if storage remains unavailable.
        }
        return false;
    }
}
