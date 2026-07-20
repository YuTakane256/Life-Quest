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

import { useMobileTitleStore } from './useMobileTitleStore';

function reset() {
    enqueued.length = 0;
    useMobileTitleStore.setState({ activeTitle: null });
}

describe('Mobile useMobileTitleStore のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => vi.clearAllMocks());

    it('称号設定時、upsert_profileをp_active_title付きでenqueueする（display_name/avatarはnull）', () => {
        useMobileTitleStore.getState().setActiveTitle('収集家');

        expect(enqueued).toContainEqual({
            operation: 'upsert_profile',
            payload: { p_display_name: null, p_avatar: null, p_active_title: '収集家', p_base_version: null },
        });
    });

    it('称号クリア時、p_active_title: nullでenqueueする', () => {
        useMobileTitleStore.getState().setActiveTitle(null);

        expect(enqueued).toContainEqual({
            operation: 'upsert_profile',
            payload: { p_display_name: null, p_avatar: null, p_active_title: null, p_base_version: null },
        });
    });
});
