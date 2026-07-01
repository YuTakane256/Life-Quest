export type PersistedStoreDomain =
    | 'tasks'
    | 'habits'
    | 'game'
    | 'stats'
    | 'settings'
    | 'battle';

export interface PersistedStoreDefinition {
    storageKey: string;
    label: string;
    domain: PersistedStoreDomain;
    requiredForBackup: boolean;
    version: number | null;
    migrationOwner: 'web-store' | 'settings-store' | 'shared-game-state';
}

export const PERSISTED_STORE_MANIFEST = [
    {
        storageKey: 'quest-board-tasks',
        label: 'タスク',
        domain: 'tasks',
        requiredForBackup: true,
        version: null,
        migrationOwner: 'web-store',
    },
    {
        storageKey: 'quest-board-habits',
        label: '習慣',
        domain: 'habits',
        requiredForBackup: true,
        version: null,
        migrationOwner: 'web-store',
    },
    {
        storageKey: 'quest-board-game',
        label: 'キャラクター',
        domain: 'game',
        requiredForBackup: true,
        version: null,
        migrationOwner: 'shared-game-state',
    },
    {
        storageKey: 'quest-board-stats',
        label: '統計',
        domain: 'stats',
        requiredForBackup: true,
        version: 1,
        migrationOwner: 'web-store',
    },
    {
        storageKey: 'quest-board-theme',
        label: 'テーマ',
        domain: 'settings',
        requiredForBackup: false,
        version: 1,
        migrationOwner: 'settings-store',
    },
    {
        storageKey: 'quest-board-motion',
        label: '動きの量',
        domain: 'settings',
        requiredForBackup: false,
        version: 1,
        migrationOwner: 'settings-store',
    },
    {
        storageKey: 'quest-board-notifications',
        label: '通知',
        domain: 'settings',
        requiredForBackup: false,
        version: 1,
        migrationOwner: 'settings-store',
    },
    {
        storageKey: 'quest-board-login-bonus',
        label: 'ログインボーナス',
        domain: 'game',
        requiredForBackup: false,
        version: 1,
        migrationOwner: 'shared-game-state',
    },
    {
        storageKey: 'quest-board-battle-history',
        label: 'バトル履歴',
        domain: 'battle',
        requiredForBackup: false,
        version: 1,
        migrationOwner: 'shared-game-state',
    },
    {
        storageKey: 'quest-board-task-sort',
        label: 'タスク並び順',
        domain: 'settings',
        requiredForBackup: false,
        version: 1,
        migrationOwner: 'settings-store',
    },
    {
        storageKey: 'quest-board-habit-sort',
        label: '習慣並び順',
        domain: 'settings',
        requiredForBackup: false,
        version: 1,
        migrationOwner: 'settings-store',
    },
    {
        storageKey: 'quest-board-title',
        label: '称号',
        domain: 'settings',
        requiredForBackup: false,
        version: 1,
        migrationOwner: 'settings-store',
    },
] as const satisfies readonly PersistedStoreDefinition[];

export const PERSISTED_STORE_KEYS = PERSISTED_STORE_MANIFEST.map((store) => store.storageKey);

export function getPersistedStoreDefinition(storageKey: string): PersistedStoreDefinition | undefined {
    return PERSISTED_STORE_MANIFEST.find((store) => store.storageKey === storageKey);
}
