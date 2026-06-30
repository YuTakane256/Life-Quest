import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChestReward, Equipment } from '../types';
import { EQUIPMENT_POOL } from '../config/gameConfig';
import {
    MAX_CHEST_QUEUE_ITEMS,
    MAX_EQUIPMENT_ITEMS,
    useGameStore,
} from './useGameStore';

function makeEquipment(index: number, equipped = false): Equipment {
    const template = EQUIPMENT_POOL[0];
    return {
        id: `eq-${index}`,
        templateId: template.id,
        name: template.name,
        slot: template.slot,
        rarity: template.rarity,
        attackBonus: template.attackBonus,
        defenseBonus: template.defenseBonus,
        hpBonus: template.hpBonus,
        equipped,
    };
}

function makeChest(index: number, opened: boolean): ChestReward {
    return {
        id: `chest-${index}`,
        chestType: 'wood',
        label: `${index}`,
        opened,
        equipment: null,
    };
}

describe('useGameStore collection limits', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(Math, 'random').mockReturnValue(0);
        useGameStore.setState({
            equipment: [],
            chestQueue: [],
            pendingChestReveal: null,
        });
    });

    afterEach(() => vi.restoreAllMocks());

    it('宝箱付与時に未開封の新しい宝箱を残して上限を維持する', () => {
        useGameStore.setState({
            chestQueue: Array.from({ length: MAX_CHEST_QUEUE_ITEMS }, (_, index) => makeChest(index, true)),
        });

        useGameStore.getState().grantChest('gold', '新しい宝箱');

        const queue = useGameStore.getState().chestQueue;
        expect(queue).toHaveLength(MAX_CHEST_QUEUE_ITEMS);
        expect(queue.some((chest) => chest.id === 'chest-0')).toBe(false);
        expect(queue[queue.length - 1]).toMatchObject({ label: '新しい宝箱', opened: false });
    });

    it('宝箱開封時に装備中アイテムと獲得した新装備を残して上限を維持する', () => {
        useGameStore.setState({
            equipment: Array.from(
                { length: MAX_EQUIPMENT_ITEMS },
                (_, index) => makeEquipment(index, index === 0)
            ),
            chestQueue: [makeChest(0, false)],
        });

        useGameStore.getState().openChest('chest-0');

        const equipment = useGameStore.getState().equipment;
        expect(equipment).toHaveLength(MAX_EQUIPMENT_ITEMS);
        expect(equipment.some((item) => item.id === 'eq-0' && item.equipped)).toBe(true);
        expect(equipment.some((item) => item.id === 'eq-1')).toBe(false);
        expect(equipment.some((item) => !item.id.startsWith('eq-'))).toBe(true);
    });
});
