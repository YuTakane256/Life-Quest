import { describe, expect, it } from 'vitest';
import {
    getPersistedStoreDefinition,
    PERSISTED_STORE_KEYS,
    PERSISTED_STORE_MANIFEST,
} from './persistedStoreManifest';
import battleHistoryStoreSource from '../stores/useBattleHistoryStore.ts?raw';
import friendsStoreSource from '../stores/useFriendsStore.ts?raw';
import gameStoreSource from '../stores/useGameStore.ts?raw';
import habitSortStoreSource from '../stores/useHabitSortStore.ts?raw';
import habitStoreSource from '../stores/useHabitStore.ts?raw';
import loginBonusStoreSource from '../stores/useLoginBonusStore.ts?raw';
import motionStoreSource from '../stores/useMotionStore.ts?raw';
import notificationStoreSource from '../stores/useNotificationStore.ts?raw';
import statsStoreSource from '../stores/useStatsStore.ts?raw';
import taskSortStoreSource from '../stores/useTaskSortStore.ts?raw';
import taskStoreSource from '../stores/useTaskStore.ts?raw';
import themeStoreSource from '../stores/useThemeStore.ts?raw';
import titleStoreSource from '../stores/useTitleStore.ts?raw';

const persistedStoreSources = [
    battleHistoryStoreSource,
    friendsStoreSource,
    gameStoreSource,
    habitSortStoreSource,
    habitStoreSource,
    loginBonusStoreSource,
    motionStoreSource,
    notificationStoreSource,
    statsStoreSource,
    taskSortStoreSource,
    taskStoreSource,
    themeStoreSource,
    titleStoreSource,
].join('\n');

function extractPersistedStoreKeys(source: string): string[] {
    return Array.from(source.matchAll(/name:\s*'(quest-board-[^']+)'/g), (match) => match[1]).sort();
}

describe('persisted store manifest', () => {
    it('keeps storage keys unique and lookupable', () => {
        expect(new Set(PERSISTED_STORE_KEYS).size).toBe(PERSISTED_STORE_KEYS.length);
        for (const key of PERSISTED_STORE_KEYS) {
            expect(getPersistedStoreDefinition(key)?.storageKey).toBe(key);
        }
    });

    it('documents every persisted Zustand store key in source', () => {
        expect([...PERSISTED_STORE_KEYS].sort()).toEqual(extractPersistedStoreKeys(persistedStoreSources));
    });

    it('marks core gameplay buckets as required for backups', () => {
        const requiredKeys = PERSISTED_STORE_MANIFEST
            .filter((store) => store.requiredForBackup)
            .map((store) => store.storageKey)
            .sort();

        expect(requiredKeys).toEqual([
            'quest-board-game',
            'quest-board-habits',
            'quest-board-stats',
            'quest-board-tasks',
        ]);
    });

    it('uses explicit positive versions or null for legacy unversioned stores', () => {
        for (const store of PERSISTED_STORE_MANIFEST) {
            expect(store.version === null || (Number.isInteger(store.version) && store.version > 0)).toBe(true);
        }
    });
});
