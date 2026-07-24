import { describe, expect, it, vi } from 'vitest';
import { createReconnectDetector, resolveNetworkOnlineState } from './networkRecovery';

describe('createReconnectDetector', () => {
    it('初回のオンライン通知では再接続処理を行わない', () => {
        const onReconnect = vi.fn();
        const detect = createReconnectDetector(onReconnect);

        detect(true);

        expect(onReconnect).not.toHaveBeenCalled();
    });

    it('offlineからonlineへ戻った時だけ再接続処理を行う', () => {
        const onReconnect = vi.fn();
        const detect = createReconnectDetector(onReconnect);

        detect(false);
        detect(true);
        detect(true);
        detect(false);
        detect(true);

        expect(onReconnect).toHaveBeenCalledTimes(2);
    });

    it('接続状態が不明な通知は再接続とも状態更新とも扱わない', () => {
        const onReconnect = vi.fn();
        const detect = createReconnectDetector(onReconnect);

        detect(false);
        detect(null);
        detect(true);

        expect(onReconnect).toHaveBeenCalledTimes(1);
    });
});

describe('resolveNetworkOnlineState', () => {
    it('isConnected=falseはreachabilityが不明でも明示的なオフラインとして扱う', () => {
        expect(resolveNetworkOnlineState({ isConnected: false, isInternetReachable: null })).toBe(false);
    });

    it('接続済みでもreachabilityが不明なら状態不明を返す', () => {
        expect(resolveNetworkOnlineState({ isConnected: true, isInternetReachable: null })).toBeNull();
    });

    it('両方が確認できた時だけオンラインを返す', () => {
        expect(resolveNetworkOnlineState({ isConnected: true, isInternetReachable: true })).toBe(true);
        expect(resolveNetworkOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
    });
});
