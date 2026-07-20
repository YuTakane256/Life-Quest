import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTitleStore } from './useTitleStore';
import { enqueueCloudOperation } from '../platform/cloudOutbox';

vi.mock('../platform/cloudOutbox', () => ({
    enqueueCloudOperation: vi.fn(async () => true),
    isWebCloudOutboxActive: vi.fn(() => true),
}));

const enqueueMock = vi.mocked(enqueueCloudOperation);

function reset() {
    localStorage.clear();
    enqueueMock.mockClear();
    useTitleStore.setState({ activeTitle: null });
}

describe('useTitleStore のクラウド同期配線', () => {
    beforeEach(() => reset());
    afterEach(() => vi.clearAllMocks());

    it('称号設定時、upsert_profileをp_active_title付きでenqueueする（display_name/avatarはnull）', () => {
        useTitleStore.getState().setActiveTitle('収集家');

        expect(enqueueMock).toHaveBeenCalledWith('upsert_profile', {
            p_display_name: null,
            p_avatar: null,
            p_active_title: '収集家',
            p_base_version: null,
        });
    });

    it('称号クリア時、p_active_title: nullでenqueueする', () => {
        useTitleStore.getState().setActiveTitle(null);

        expect(enqueueMock).toHaveBeenCalledWith('upsert_profile', {
            p_display_name: null,
            p_avatar: null,
            p_active_title: null,
            p_base_version: null,
        });
    });

    it('サニタイズ後の値をenqueueする（前後空白除去・40文字切り詰め）', () => {
        useTitleStore.getState().setActiveTitle('x'.repeat(80));

        expect(enqueueMock).toHaveBeenCalledWith('upsert_profile', expect.objectContaining({
            p_active_title: 'x'.repeat(40),
        }));
    });
});
