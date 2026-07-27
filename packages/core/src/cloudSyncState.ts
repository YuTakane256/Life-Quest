import type { CloudOutboxPublicState } from './cloudOutboxController.ts';

export type CloudPullPhase = 'idle' | 'pulling' | 'failed';

export interface CloudSyncPublicState {
    availability: 'inactive' | 'ready' | 'offline' | 'auth-required';
    push: CloudOutboxPublicState;
    pull: { phase: CloudPullPhase; lastSuccessAt: string | null };
    attention: 'none' | 'waiting' | 'required';
}

export function createInactiveCloudSyncState(): CloudSyncPublicState {
    return {
        availability: 'inactive',
        push: {
            availability: 'inactive', pending: 0, inflight: 0, failed: 0, conflict: 0,
            oldestPendingAt: null, lastPushSuccessAt: null, failureKinds: [],
        },
        pull: { phase: 'idle', lastSuccessAt: null },
        attention: 'none',
    };
}

export function deriveCloudSyncAttention(
    push: CloudOutboxPublicState,
    pull: CloudSyncPublicState['pull'],
): CloudSyncPublicState['attention'] {
    if (push.failed > 0 || push.conflict > 0 || pull.phase === 'failed' || push.failureKinds.includes('auth-required')) {
        return 'required';
    }
    if (push.pending > 0 || push.inflight > 0) return 'waiting';
    return 'none';
}
