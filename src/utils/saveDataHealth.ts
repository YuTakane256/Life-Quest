import { utf8ByteLength } from './bytes';
import { getWebLocalStorage } from '../platform/storage';

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

type StateValidator = (state: Record<string, unknown>) => boolean;

interface SaveDataSectionDefinition {
    key: string;
    label: string;
    required: boolean;
    validate: StateValidator;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasArray(state: Record<string, unknown>, key: string): boolean {
    return Array.isArray(state[key]);
}

function hasRecord(state: Record<string, unknown>, key: string): boolean {
    return isRecord(state[key]);
}

export const SAVE_DATA_SECTION_KEYS = [
    'quest-board-tasks',
    'quest-board-habits',
    'quest-board-game',
    'quest-board-stats',
    'quest-board-theme',
    'quest-board-motion',
    'quest-board-notifications',
    'quest-board-login-bonus',
    'quest-board-battle-history',
    'quest-board-task-sort',
    'quest-board-habit-sort',
    'quest-board-friends',
    'quest-board-title',
] as const;

const SAVE_DATA_SECTIONS: readonly SaveDataSectionDefinition[] = [
    { key: 'quest-board-tasks', label: 'タスク', required: true, validate: (state) => hasArray(state, 'tasks') },
    { key: 'quest-board-habits', label: '習慣', required: true, validate: (state) => hasArray(state, 'habits') && hasArray(state, 'dailyRecords') && hasArray(state, 'restDays') },
    { key: 'quest-board-game', label: 'キャラクター', required: true, validate: (state) => hasRecord(state, 'character') && hasArray(state, 'equipment') && hasArray(state, 'chestQueue') && hasRecord(state, 'battle') },
    { key: 'quest-board-stats', label: '統計', required: true, validate: (state) => hasRecord(state, 'taskXpLog') && hasRecord(state, 'habitLog') },
    { key: 'quest-board-theme', label: 'テーマ', required: false, validate: (state) => typeof state.mode === 'string' },
    { key: 'quest-board-motion', label: '動きの量', required: false, validate: (state) => typeof state.mode === 'string' },
    { key: 'quest-board-notifications', label: '通知', required: false, validate: (state) => typeof state.enabled === 'boolean' && hasArray(state, 'notifiedTaskIds') },
    { key: 'quest-board-login-bonus', label: 'ログインボーナス', required: false, validate: (state) => (state.lastLoginDate === null || typeof state.lastLoginDate === 'string') && typeof state.streak === 'number' },
    { key: 'quest-board-battle-history', label: 'バトル履歴', required: false, validate: (state) => hasArray(state, 'history') },
    { key: 'quest-board-task-sort', label: 'タスク並び順', required: false, validate: (state) => typeof state.sortMode === 'string' },
    { key: 'quest-board-habit-sort', label: '習慣並び順', required: false, validate: (state) => typeof state.sortMode === 'string' },
    { key: 'quest-board-friends', label: '友達', required: false, validate: (state) => hasArray(state, 'friends') },
    { key: 'quest-board-title', label: '称号', required: false, validate: (state) => state.activeTitle === null || typeof state.activeTitle === 'string' },
];

function inspectSection(storage: Storage, section: SaveDataSectionDefinition): SaveDataSectionReport {
    const value = storage.getItem(section.key);
    if (value === null) {
        return { ...section, status: 'missing', byteLength: 0 };
    }

    try {
        const parsed: unknown = JSON.parse(value);
        const envelope = isRecord(parsed) ? parsed : null;
        const state = envelope && isRecord(envelope.state) ? envelope.state : null;
        return {
            key: section.key,
            label: section.label,
            required: section.required,
            status: state && section.validate(state) ? 'healthy' : 'invalid',
            byteLength: utf8ByteLength(section.key) + utf8ByteLength(value),
        };
    } catch {
        return {
            key: section.key,
            label: section.label,
            required: section.required,
            status: 'invalid',
            byteLength: utf8ByteLength(section.key) + utf8ByteLength(value),
        };
    }
}

export function inspectSaveDataHealth(storage: Storage | null | undefined = getWebLocalStorage()): SaveDataHealthReport {
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
