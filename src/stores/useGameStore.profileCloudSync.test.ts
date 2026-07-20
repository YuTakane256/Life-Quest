import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { enqueueCloudOperation } from '../platform/cloudOutbox';

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async () => true),
    isWebCloudOutboxActive: vi.fn(() => true),
}));

const enqueueMock = vi.mocked(enqueueCloudOperation);

function reset() {
    localStorage.clear();
    enqueueMock.mockClear();
    useGameStore.setState({
        character: {
            name: 'あなた', avatar: 'female', level: 1, totalXp: 0,
            baseAttack: 5, baseDefense: 3, baseMaxHp: 50,
        },
    });
}

describe('useGameStore.updateCharacter のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => vi.clearAllMocks());

    it('名前変更時、update_character_profileを現在のname/avatarでenqueueする', () => {
        useGameStore.getState().updateCharacter({ name: 'テスター' });

        expect(enqueueMock).toHaveBeenCalledWith('update_character_profile', {
            p_name: 'テスター',
            p_avatar: 'female',
            p_base_version: null,
        });
    });

    it('アバター変更時、変更後の値と既存の名前を合わせてenqueueする', () => {
        useGameStore.getState().updateCharacter({ avatar: 'male' });

        expect(enqueueMock).toHaveBeenCalledWith('update_character_profile', {
            p_name: 'あなた',
            p_avatar: 'male',
            p_base_version: null,
        });
    });
});
