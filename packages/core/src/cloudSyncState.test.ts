import { describe, expect, it } from 'vitest';
import { canRequestCloudSync, cloudSyncMessage, createInactiveCloudSyncState, deriveCloudSyncAttention,
    deriveCloudSyncAvailability, isCloudSyncBusy, type CloudSyncPublicState } from './cloudSyncState.ts';

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

describe('shared sync feedback', () => {
    const state = (changes: Partial<CloudSyncPublicState> = {}): CloudSyncPublicState => ({
        availability: 'ready', push: { ...readyPush }, attention: 'none',
        pull: { phase: 'idle', lastSuccessAt: '2026-10-17T00:00:00Z' }, ...changes,
    });
    it.each([true, null])('接続%sはサーバー成功を意味せず、未知の接続はofflineと決めつけない', (online) => {
        expect(deriveCloudSyncAvailability(readyPush, online)).toBe('ready');
        expect(cloudSyncMessage(state({ pull: { phase: 'idle', lastSuccessAt: null } }))).not.toBe('同期済み');
    });
    it('オフライン・非接続・再ログイン待ちの優先度を区別する', () => {
        expect(deriveCloudSyncAvailability(readyPush, false)).toBe('offline');
        expect(deriveCloudSyncAvailability({ ...readyPush, availability: 'inactive' }, false)).toBe('inactive');
        expect(deriveCloudSyncAvailability({ ...readyPush, failureKinds: ['auth-required'] }, false)).toBe('auth-required');
    });
    it('過去に成功していても確認中は同期済みと表示しない', () => {
        const current = state({ pull: { phase: 'pulling', lastSuccessAt: '2026-10-17T00:00:00Z' } });
        expect(cloudSyncMessage(current)).toBe('クラウドの変更を確認しています');
        expect(deriveCloudSyncAttention(current.push, current.pull)).toBe('waiting');
        expect(isCloudSyncBusy(current)).toBe(true); expect(canRequestCloudSync(current)).toBe(false);
    });
    it.each(['inactive', 'offline', 'auth-required'] as const)('%sでは手動同期できない', (availability) => {
        expect(canRequestCloudSync(state({ availability }))).toBe(false);
        expect(cloudSyncMessage(state({ availability }))).not.toBe('同期済み');
    });
    it('offline中の未送信件数を示し、内容やraw errorを表示しない', () => {
        expect(cloudSyncMessage(state({ availability: 'offline', push: { ...readyPush, pending: 2 } }))).toBe('オフラインです。接続後に同期する変更: 2件');
    });
    it('送信中はbusy、待機だけなら手動再試行可能', () => {
        expect(isCloudSyncBusy(state({ push: { ...readyPush, inflight: 1 } }))).toBe(true);
        expect(canRequestCloudSync(state({ push: { ...readyPush, pending: 1 } }))).toBe(true);
        expect(cloudSyncMessage(state({ push: { ...readyPush, inflight: 1, pending: 2 } }))).toContain('3件');
    });
    it('auth-requiredの互換状態でも再試行を勧めない', () => {
        const current = state({ push: { ...readyPush, pending: 1, failureKinds: ['auth-required'] } });
        expect(canRequestCloudSync(current)).toBe(false); expect(cloudSyncMessage(current)).toContain('再ログイン');
    });
    it('競合・恒久失敗を単純な再試行で解消できると案内しない', () => {
        expect(cloudSyncMessage(state({ push: { ...readyPush, conflict: 1, pending: 1 } }))).toContain('競合');
        expect(cloudSyncMessage(state({ push: { ...readyPush, failed: 1 }, availability: 'offline' }))).toContain('自動再送しません');
    });
    it.each(['failed', 'conflict'] as const)('%sが残っていても、新しい変更のオフライン待機を隠さない', (kind) => {
        const current = state({ availability: 'offline', push: { ...readyPush, [kind]: 1, pending: 4, inflight: 1 }, attention: 'required' });
        expect(cloudSyncMessage(current)).toContain('自動再送しません。オフラインです。接続後に同期する変更: 5件');
        expect(cloudSyncMessage(current)).toContain(kind === 'failed' ? '同期できませんでした' : '競合');
        expect(cloudSyncMessage(current)).not.toContain('同期済み');
        expect(canRequestCloudSync(current)).toBe(false);
    });
    it.each(['failed', 'conflict'] as const)('%sと現在の送信/待機を両方示し、完了後も古い注意を維持する', (kind) => {
        const current = state({ push: { ...readyPush, [kind]: 1, pending: 2 }, attention: 'required' });
        expect(cloudSyncMessage(current)).toContain('同期を待っている変更: 2件');
        expect(canRequestCloudSync(current)).toBe(true);
        current.push.inflight = 1;
        expect(cloudSyncMessage(current)).toContain('同期中です。送信待ちの変更: 3件');
        current.push.pending = 0; current.push.inflight = 0;
        expect(cloudSyncMessage(current)).toBe(kind === 'failed'
            ? '一部の変更を同期できませんでした。今すぐ同期では自動再送しません'
            : '一部の変更に競合があります。今すぐ同期では自動再送しません');
    });
    it('未送信0件のofflineも示し、認証待ちの優先度とpull失敗の案内を保つ', () => {
        expect(cloudSyncMessage(state({ availability: 'offline', push: { ...readyPush, failed: 1 } })))
            .toContain('自動再送しません。オフラインです。接続後にクラウドの変更を確認します');
        expect(cloudSyncMessage(state({ availability: 'auth-required', push: { ...readyPush, failed: 1, pending: 2 } })))
            .toBe('再ログインすると保留中の同期を再開できます');
        expect(cloudSyncMessage(state({ push: { ...readyPush, pending: 2 }, pull: { phase: 'failed', lastSuccessAt: null } })))
            .toContain('再試行してください');
    });
    it('失敗後は再試行でき、成功したidleのみ同期済みと表示する', () => {
        const current = state({ pull: { phase: 'failed', lastSuccessAt: '2026-10-17T00:00:00Z' } });
        expect(cloudSyncMessage(current)).toContain('再試行'); expect(canRequestCloudSync(current)).toBe(true);
        expect(cloudSyncMessage(state())).toBe('同期済み');
    });
});
