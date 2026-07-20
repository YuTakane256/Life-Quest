/**
 * Mobile装備売却のクラウド同期配線テスト。Web `useGameStore.sellCloudSync.test.ts`のミラー。
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

const enqueued: { operation: string; payload: Record<string, unknown>; options?: Record<string, unknown> }[] = [];

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async (operation: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => {
        enqueued.push({ operation, payload, options });
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
    useMobileGameStore.setState({
        equipment: [],
        hasHydrated: true,
        addXp: vi.fn() as unknown as ReturnType<typeof useMobileGameStore.getState>['addXp'],
    });
}

describe('Mobile useMobileGameStore.sellItem のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => vi.clearAllMocks());

    it('売却成功時、sell_itemをdependsOnEntityIds付きでenqueueする', () => {
        useMobileGameStore.setState({ equipment: [item('w', 'wooden_sword', false)] });

        useMobileGameStore.getState().sellItem('w');

        expect(enqueued).toContainEqual({
            operation: 'sell_item',
            payload: { itemId: 'w' },
            options: { dependsOnEntityIds: ['w'] },
        });
    });

    it('装備中で売却できなかった場合はenqueueしない', () => {
        useMobileGameStore.setState({ equipment: [item('w', 'wooden_sword', true)] });

        useMobileGameStore.getState().sellItem('w');

        expect(enqueued).toHaveLength(0);
    });

    it('存在しないidの場合はenqueueしない', () => {
        useMobileGameStore.setState({ equipment: [item('w', 'wooden_sword')] });

        useMobileGameStore.getState().sellItem('nope');

        expect(enqueued).toHaveLength(0);
    });
});
