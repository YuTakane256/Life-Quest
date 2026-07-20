/**
 * Mobile装備装着のクラウド同期配線テスト。Web `useGameStore.equipCloudSync.test.ts`のミラー。
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

import { createEquipmentFromTemplate, type Equipment } from '@life-quest/core/equipment';
import { EQUIPMENT_POOL } from '@life-quest/core/rewards';
import { useMobileGameStore } from './useMobileGameStore';

function template(id: string) {
    const found = EQUIPMENT_POOL.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Unknown template: ${id}`);
    return found;
}

function item(id: string, templateId: string, equipped = false): Equipment {
    return { ...createEquipmentFromTemplate(id, template(templateId)), equipped };
}

function reset() {
    enqueued.length = 0;
    useMobileGameStore.setState({ equipment: [], hasHydrated: true });
}

describe('Mobile 装備装着のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => vi.clearAllMocks());

    it('equipItem: 装着後の装着中ID集合をset_equipped_itemsでenqueueする', () => {
        useMobileGameStore.setState({ equipment: [item('w1', 'wooden_sword', false)] });

        useMobileGameStore.getState().equipItem('w1');

        expect(enqueued).toContainEqual({ operation: 'set_equipped_items', payload: { p_item_ids: ['w1'] } });
    });

    it('unequipItem: 解除後の装着中ID集合をenqueueする', () => {
        useMobileGameStore.setState({
            equipment: [item('w1', 'wooden_sword', true), item('a1', 'leather_armor', true)],
        });

        useMobileGameStore.getState().unequipItem('w1');

        expect(enqueued).toContainEqual({ operation: 'set_equipped_items', payload: { p_item_ids: ['a1'] } });
    });

    it('autoEquipBest: 変更があった場合のみenqueueする', () => {
        useMobileGameStore.setState({
            equipment: [item('weak', 'wooden_sword', true), item('strong', 'iron_sword', false)],
        });

        const changed = useMobileGameStore.getState().autoEquipBest();

        expect(changed).toBe(true);
        expect(enqueued).toContainEqual({ operation: 'set_equipped_items', payload: { p_item_ids: ['strong'] } });
    });

    it('autoEquipBest: 既に最強装備済みならenqueueしない', () => {
        useMobileGameStore.setState({ equipment: [item('only', 'wooden_sword', true)] });

        const changed = useMobileGameStore.getState().autoEquipBest();

        expect(changed).toBe(false);
        expect(enqueued).toHaveLength(0);
    });

    it('未hydration時はenqueueしない', () => {
        useMobileGameStore.setState({ equipment: [item('w1', 'wooden_sword', false)], hasHydrated: false });

        useMobileGameStore.getState().equipItem('w1');

        expect(enqueued).toHaveLength(0);
    });
});
