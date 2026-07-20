import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { enqueueCloudOperation } from '../platform/cloudOutbox';
import type { Equipment } from '../types';

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async () => true),
    isWebCloudOutboxActive: vi.fn(() => false),
}));

const enqueueMock = vi.mocked(enqueueCloudOperation);

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
    return {
        id: 'eq-' + Math.random().toString(36).slice(2, 8),
        templateId: 'wooden_sword',
        name: '木の剣',
        slot: 'weapon',
        rarity: 'common',
        attackBonus: 2,
        defenseBonus: 0,
        hpBonus: 0,
        equipped: false,
        ...overrides,
    };
}

const originalAddXp = useGameStore.getState().addXp;

function reset() {
    localStorage.clear();
    enqueueMock.mockClear();
    useGameStore.setState({ equipment: [], addXp: vi.fn() as unknown as typeof originalAddXp });
}

describe('useGameStore.sellItem のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => useGameStore.setState({ addXp: originalAddXp }));

    it('売却成功時、sell_itemをdependsOnEntityIds付きでenqueueする', () => {
        useGameStore.setState({ equipment: [makeEquipment({ id: 'w', equipped: false })] });

        useGameStore.getState().sellItem('w');

        expect(enqueueMock).toHaveBeenCalledWith(
            'sell_item',
            { itemId: 'w' },
            { dependsOnEntityIds: ['w'] },
        );
    });

    it('装備中で売却できなかった場合はenqueueしない', () => {
        useGameStore.setState({ equipment: [makeEquipment({ id: 'w', equipped: true })] });

        useGameStore.getState().sellItem('w');

        expect(enqueueMock).not.toHaveBeenCalled();
    });

    it('存在しないidの場合はenqueueしない', () => {
        useGameStore.setState({ equipment: [makeEquipment({ id: 'w' })] });

        useGameStore.getState().sellItem('nope');

        expect(enqueueMock).not.toHaveBeenCalled();
    });
});
