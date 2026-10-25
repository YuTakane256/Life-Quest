import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { captureAuthSessionGuard, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';
import { canRequestCloudSync, cloudSyncMessage, isCloudSyncBusy, type CloudSyncPublicState } from '@life-quest/core/cloudSyncState';
import { getWebCloudSyncState, subscribeWebCloudSyncState, syncWebNow } from '../../platform/cloudSync';

export function CloudSyncSettings() {
    const [state, setState] = useState<CloudSyncPublicState>(getWebCloudSyncState);
    const [syncing, setSyncing] = useState(false);
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        const unsubscribe = subscribeAuthSessionScope(() => setSyncing(false));
        return () => { mounted.current = false; unsubscribe(); };
    }, []);
    useEffect(() => subscribeWebCloudSyncState(setState), []);
    const hasAttention = state.attention === 'required';
    const canSync = canRequestCloudSync(state) && !syncing;
    const busy = state.availability === 'ready' && (syncing || isCloudSyncBusy(state));

    const handleSync = async (): Promise<void> => {
        if (!canSync) return;
        const isCurrent = captureAuthSessionGuard();
        setSyncing(true);
        try { await syncWebNow(); } finally { if (mounted.current && isCurrent()) setSyncing(false); }
    };

    return (
        <section
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--color-bg-card)', border: `1px solid ${hasAttention ? 'var(--color-text-danger)' : 'var(--color-border-default)'}` }}
            aria-label="同期"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-40">
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>同期</h2>
                    <p role={hasAttention ? 'alert' : 'status'} aria-live="polite" className="text-xs mt-1" style={{ color: hasAttention ? 'var(--color-text-danger)' : 'var(--color-text-muted)' }}>
                        {hasAttention && <TriangleAlert size={14} className="inline mr-1 align-text-bottom" aria-hidden="true" />}
                        {cloudSyncMessage(state)}
                    </p>
                    {state.pull.lastSuccessAt && !hasAttention && (
                        <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>最終確認: {new Date(state.pull.lastSuccessAt).toLocaleString('ja-JP')}</p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => { void handleSync(); }}
                    disabled={!canSync}
                    className="min-h-11 shrink-0 whitespace-nowrap px-3 rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
                    style={{ color: 'var(--color-accent-primary)', border: '1px solid var(--color-border-default)' }}
                    aria-label="今すぐ同期"
                    aria-busy={busy}
                >
                    <RefreshCw size={16} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
                    {busy ? '同期中' : '今すぐ同期'}
                </button>
            </div>
        </section>
    );
}
