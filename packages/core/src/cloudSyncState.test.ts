import { describe, expect, it } from 'vitest';
import { createInactiveCloudSyncState, deriveCloudSyncAttention } from './cloudSyncState.ts';

const readyPush = {
    availability: 'ready' as const,
    pending: 0,
    inflight: 0,
    failed: 0,
    conflict: 0,
    oldestPendingAt: null,
    lastPushSuccessAt: null,
    failureKinds: [],
};

describe('cloud sync public state', () => {
    it('inactive stateはユーザー固有情報や操作内容を持たない', () => {
        expect(createInactiveCloudSyncState()).toEqual({
            availability: 'inactive',
            push: { ...readyPush, availability: 'inactive' },
            pull: { phase: 'idle', lastSuccessAt: null },
            attention: 'none',
        });
    });

    it('pushが空でもpull失敗なら同期済みと判定しない', () => {
        expect(deriveCloudSyncAttention(readyPush, { phase: 'failed', lastSuccessAt: null })).toBe('required');
    });

    it('保留中は控えめな待機、恒久失敗と競合は注意を要求する', () => {
        expect(deriveCloudSyncAttention({ ...readyPush, pending: 1 }, { phase: 'idle', lastSuccessAt: null })).toBe('waiting');
        expect(deriveCloudSyncAttention({ ...readyPush, failed: 1 }, { phase: 'idle', lastSuccessAt: null })).toBe('required');
        expect(deriveCloudSyncAttention({ ...readyPush, conflict: 1 }, { phase: 'idle', lastSuccessAt: null })).toBe('required');
    });
});
