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
}

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
    };
}

export function importAllData(data: BackupData): boolean {
    try {
        localStorage.setItem('quest-board-tasks', JSON.stringify(data.tasks));
        localStorage.setItem('quest-board-habits', JSON.stringify(data.habits));
        localStorage.setItem('quest-board-game', JSON.stringify(data.game));
        localStorage.setItem('quest-board-stats', JSON.stringify(data.stats));
        if (data.theme) localStorage.setItem('quest-board-theme', JSON.stringify(data.theme));
        return true;
    } catch {
        return false;
    }
}
