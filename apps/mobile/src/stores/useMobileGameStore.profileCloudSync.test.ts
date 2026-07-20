/**
 * Mobile updateCharacterのクラウド同期配線テスト。Web `useGameStore.profileCloudSync.test.ts`のミラー。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => { memory.set(key, value); }),
        removeItem: vi.fn(async (key: string) => { memory.delete(key); }),
    },
}));

const enqueued: { operation: string; payload: Record<string, unknown> }[] = [];

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async (operation: string, payload: Record<string, unknown>) => {
        enqueued.push({ operation, payload });
        return true;
    }),
    isCloudOutboxActive: vi.fn(() => true),
}));

import { useMobileGameStore } from './useMobileGameStore';

function reset() {
    enqueued.length = 0;
    useMobileGameStore.setState({
        character: {
            name: 'あなた', avatar: 'female', level: 1, totalXp: 0,
            baseAttack: 5, baseDefense: 3, baseMaxHp: 50,
        },
        hasHydrated: true,
    });
}

describe('Mobile useMobileGameStore.updateCharacter のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => vi.clearAllMocks());

    it('名前変更時、update_character_profileを現在のname/avatarでenqueueする', () => {
        useMobileGameStore.getState().updateCharacter({ name: 'テスター' });

        expect(enqueued).toContainEqual({
            operation: 'update_character_profile',
            payload: { p_name: 'テスター', p_avatar: 'female', p_base_version: null },
        });
    });

    it('アバター変更時、変更後の値と既存の名前を合わせてenqueueする', () => {
        useMobileGameStore.getState().updateCharacter({ avatar: 'male' });

        expect(enqueued).toContainEqual({
            operation: 'update_character_profile',
            payload: { p_name: 'あなた', p_avatar: 'male', p_base_version: null },
        });
    });

    it('未hydration時はenqueueしない', () => {
        useMobileGameStore.setState({ hasHydrated: false });
        useMobileGameStore.getState().updateCharacter({ name: 'テスター' });

        expect(enqueued).toHaveLength(0);
    });
});
