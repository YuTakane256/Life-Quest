import AsyncStorage from '@react-native-async-storage/async-storage';
import { CANONICAL_STORAGE_KEYS } from '@life-quest/core/syncRepository';
import { LEGACY_STORAGE_KEYS } from '@life-quest/core/legacyMigration';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateMobileLegacyData } from './legacyMigration';

const memory = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => { memory.set(key, value); }),
        removeItem: vi.fn(async (key: string) => { memory.delete(key); }),
    },
}));

const storage = vi.mocked(AsyncStorage);

describe('migrateMobileLegacyData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        memory.clear();
    });

    it('AsyncStorageの旧キーをcanonicalへ移行し、報酬台帳を保持する', async () => {
        const legacyGame = JSON.stringify({
            state: {
                character: { name: 'モバイル勇者', avatar: 'female', totalXp: 30 },
                equipment: [],
                chestQueue: [],
                gachaCount: 3,
                rewardLedger: { rewardedTaskIds: ['t1'], rewardedSubtaskIds: [], habitBonusDates: ['2026-07-01'] },
            },
            version: 1,
        });
        memory.set(LEGACY_STORAGE_KEYS.game, legacyGame);

        const report = await migrateMobileLegacyData();

        expect(report.ok).toBe(true);
        expect(report.sections.game.status).toBe('migrated');
        const envelope = JSON.parse(memory.get(CANONICAL_STORAGE_KEYS.game)!) as {
            data: { rewardLedger: { rewardedTaskIds: string[]; habitBonusDates: string[] } };
        };
        // Mobile側だけにある報酬台帳が失われない
        expect(envelope.data.rewardLedger.rewardedTaskIds).toEqual(['t1']);
        expect(envelope.data.rewardLedger.habitBonusDates).toEqual(['2026-07-01']);
        // 旧キーは不変
        expect(memory.get(LEGACY_STORAGE_KEYS.game)).toBe(legacyGame);
    });

    it('旧キーに対してremoveItemを一度も呼ばない', async () => {
        memory.set(LEGACY_STORAGE_KEYS.tasks, JSON.stringify({ state: { tasks: [] }, version: 0 }));

        await migrateMobileLegacyData();

        expect(storage.removeItem).not.toHaveBeenCalled();
        const legacySetCalls = storage.setItem.mock.calls.filter(([key]) =>
            (Object.values(LEGACY_STORAGE_KEYS) as string[]).includes(key));
        expect(legacySetCalls).toHaveLength(0);
    });
});
