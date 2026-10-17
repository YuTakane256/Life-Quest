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
    if (push.pending > 0 || push.inflight > 0 || pull.phase === 'pulling') return 'waiting';
    return 'none';
}

/** OS connectivity is advisory: unknown is not offline, and online is not server success. */
export function deriveCloudSyncAvailability(push: CloudOutboxPublicState, online: boolean | null): CloudSyncPublicState['availability'] {
    if (push.availability === 'inactive') return 'inactive';
    if (push.failureKinds.includes('auth-required')) return 'auth-required';
    return online === false ? 'offline' : 'ready';
}

export function isCloudSyncBusy(state: CloudSyncPublicState): boolean {
    return state.availability === 'ready' && (state.pull.phase === 'pulling' || state.push.inflight > 0);
}

export function canRequestCloudSync(state: CloudSyncPublicState): boolean {
    return state.availability === 'ready' && !state.push.failureKinds.includes('auth-required') && !isCloudSyncBusy(state);
}

/** Shared information order for Web and Native; never include operation contents/errors. */
export function cloudSyncMessage(state: CloudSyncPublicState): string {
    if (state.availability === 'inactive') return 'ログインすると同期状態を確認できます';
    if (state.availability === 'auth-required' || state.push.failureKinds.includes('auth-required')) return '再ログインすると保留中の同期を再開できます';
    if (state.push.conflict > 0) return '一部の変更に競合があります。今すぐ同期では自動再送しません';
    if (state.push.failed > 0) return '一部の変更を同期できませんでした。今すぐ同期では自動再送しません';
    const waiting = state.push.pending + state.push.inflight;
    if (state.availability === 'offline') return waiting > 0
        ? `オフラインです。接続後に同期する変更: ${waiting}件` : 'オフラインです。接続後にクラウドの変更を確認します';
    if (isCloudSyncBusy(state)) return waiting > 0 ? `同期中です。送信待ちの変更: ${waiting}件` : 'クラウドの変更を確認しています';
    if (state.pull.phase === 'failed') return '同期を完了できませんでした。接続を確認して再試行してください';
    if (waiting > 0) return `同期を待っている変更: ${waiting}件`;
    if (state.pull.lastSuccessAt === null) return 'クラウドの変更を確認しています';
    return '同期済み';
}
