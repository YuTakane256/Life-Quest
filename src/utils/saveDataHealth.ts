export type SaveDataSectionStatus = 'healthy' | 'missing' | 'invalid';

export interface SaveDataSectionReport {
    key: string;
    label: string;
    required: boolean;
    status: SaveDataSectionStatus;
    byteLength: number;
}

export interface SaveDataHealthReport {
    available: boolean;
    sections: SaveDataSectionReport[];
    healthyCount: number;
    missingCount: number;
    invalidCount: number;
    totalBytes: number;
}

const SAVE_DATA_SECTIONS = [
    { key: 'quest-board-tasks', label: 'タスク', required: true },
    { key: 'quest-board-habits', label: '習慣', required: true },
    { key: 'quest-board-game', label: 'キャラクター', required: true },
    { key: 'quest-board-stats', label: '統計', required: true },
    { key: 'quest-board-theme', label: 'テーマ', required: false },
    { key: 'quest-board-motion', label: '動きの量', required: false },
    { key: 'quest-board-notifications', label: '通知', required: false },
    { key: 'quest-board-login-bonus', label: 'ログインボーナス', required: false },
    { key: 'quest-board-battle-history', label: 'バトル履歴', required: false },
    { key: 'quest-board-task-sort', label: 'タスク並び順', required: false },
    { key: 'quest-board-habit-sort', label: '習慣並び順', required: false },
] as const;

function byteLength(value: string): number {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(value).length;
    }
    return value.length * 2;
}

function inspectSection(storage: Storage, section: typeof SAVE_DATA_SECTIONS[number]): SaveDataSectionReport {
    const value = storage.getItem(section.key);
    if (value === null) {
        return { ...section, status: 'missing', byteLength: 0 };
    }

    try {
        const parsed: unknown = JSON.parse(value);
        const isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        return {
            ...section,
            status: isObject ? 'healthy' : 'invalid',
            byteLength: byteLength(section.key) + byteLength(value),
        };
    } catch {
        return {
            ...section,
            status: 'invalid',
            byteLength: byteLength(section.key) + byteLength(value),
        };
    }
}

export function inspectSaveDataHealth(storage: Storage | null | undefined = globalThis.localStorage): SaveDataHealthReport {
    if (!storage) {
        return { available: false, sections: [], healthyCount: 0, missingCount: 0, invalidCount: 0, totalBytes: 0 };
    }

    try {
        const sections = SAVE_DATA_SECTIONS.map((section) => inspectSection(storage, section));
        return {
            available: true,
            sections,
            healthyCount: sections.filter((section) => section.status === 'healthy').length,
            missingCount: sections.filter((section) => section.status === 'missing').length,
            invalidCount: sections.filter((section) => section.status === 'invalid').length,
            totalBytes: sections.reduce((sum, section) => sum + section.byteLength, 0),
        };
    } catch {
        return { available: false, sections: [], healthyCount: 0, missingCount: 0, invalidCount: 0, totalBytes: 0 };
    }
}
