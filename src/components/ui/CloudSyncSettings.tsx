import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CloudSyncPublicState } from '@life-quest/core/cloudSyncState';
import { getWebCloudSyncState, subscribeWebCloudSyncState, syncWebNow } from '../../platform/cloudSync';

function messageFor(state: CloudSyncPublicState): string {
    if (state.availability === 'inactive') return 'ログインすると同期状態を確認できます';
    if (state.push.failureKinds.includes('auth-required')) return '再ログインすると保留中の同期を再開できます';
    if (state.push.conflict > 0) return '一部の変更に競合があります。今すぐ同期では自動再送しません';
    if (state.push.failed > 0) return '一部の変更を同期できませんでした。今すぐ同期では自動再送しません';
    if (state.pull.phase === 'failed') return 'クラウドの変更を確認できませんでした。接続を確認してください';
    if (state.push.pending > 0 || state.push.inflight > 0) return `同期を待っている変更: ${state.push.pending + state.push.inflight}件`;
    if (state.pull.lastSuccessAt === null) return 'クラウドの変更を確認しています';
    return '同期済み';
}

export function CloudSyncSettings() {
    const [state, setState] = useState<CloudSyncPublicState>(getWebCloudSyncState);
    const [syncing, setSyncing] = useState(false);
    useEffect(() => subscribeWebCloudSyncState(setState), []);
    const hasAttention = state.attention === 'required';
    const canSync = state.availability === 'ready' && !syncing;

    const handleSync = async (): Promise<void> => {
        if (!canSync) return;
        setSyncing(true);
        try { await syncWebNow(); } finally { setSyncing(false); }
    };

    return (
        <section
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--color-bg-card)', border: `1px solid ${hasAttention ? 'var(--color-text-danger)' : 'var(--color-border-default)'}` }}
            aria-label="同期"
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>同期</h2>
                    <p role={hasAttention ? 'alert' : 'status'} aria-live="polite" className="text-xs mt-1" style={{ color: hasAttention ? 'var(--color-text-danger)' : 'var(--color-text-muted)' }}>
                        {hasAttention && <TriangleAlert size={14} className="inline mr-1 align-text-bottom" aria-hidden="true" />}
                        {messageFor(state)}
                    </p>
                    {state.pull.lastSuccessAt && !hasAttention && (
                        <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>最終確認: {new Date(state.pull.lastSuccessAt).toLocaleString('ja-JP')}</p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => { void handleSync(); }}
                    disabled={!canSync}
                    className="min-h-11 px-3 rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
                    style={{ color: 'var(--color-accent-primary)', border: '1px solid var(--color-border-default)' }}
                    aria-label="今すぐ同期"
                >
                    <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} aria-hidden="true" />
                    {syncing ? '同期中' : '今すぐ同期'}
                </button>
            </div>
        </section>
    );
}
