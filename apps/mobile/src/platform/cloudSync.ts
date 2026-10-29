/**
 * Mobileのクラウド同期v1（#504、ADR-008/009）。Web版（src/platform/cloudSync.ts）と同型。
 *
 * 保険プルトリガ: 起動 / AppState active復帰 / 定期5分（activeの間のみ）。
 * ネットワーク再接続トリガはAppState復帰で大半が拾えるため、
 * NetInfoによる明示検知はオフラインキュー（#505）と同時に導入する。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import { captureAuthSessionGuard, registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import {
    applyPullBatchToCache,
    createEmptyCloudCache,
    loadCloudCache,
    persistCloudCache,
    getSeedableSections,
    type CloudCache,
} from '@life-quest/core/cloudCache';
import {
    cloudCursorKey,
    createCloudPullRunner,
    createInsurancePullScheduler,
    type PullBatch,
} from '@life-quest/core/cloudPull';
import {
    createInactiveCloudSyncState,
    deriveCloudSyncAttention,
    deriveCloudSyncAvailability,
    type CloudSyncPublicState,
} from '@life-quest/core/cloudSyncState';
import { markCloudSessionSeeded } from './authStores';
import { rememberMobileCloudDisplayOwner } from './cloudSessionRecovery';
import {
    drainOutboxAndWait,
    getMobileCloudOutboxState,
    retryPendingOutbox,
    subscribeMobileCloudOutboxState,
} from './cloudOutbox';
import { applyCloudCacheToMobileStores } from './cloudSeed';
import { getMobileSupabaseClient } from './supabase';
import { createReconnectDetector, resolveNetworkOnlineState } from './networkRecovery';
import { requestMobileLoginBonusRecheck } from '../stores/useMobileLoginBonusStore';

export interface CloudSyncHandle {
    isActive: () => boolean;
    flush: () => Promise<void>;
    stop: () => void;
    syncNow: () => Promise<void>;
}

let cloudSyncState: CloudSyncPublicState = createInactiveCloudSyncState();
const cloudSyncListeners = new Set<(state: CloudSyncPublicState) => void>();
let cloudSyncGeneration = 0;

function publishCloudSyncState(next: CloudSyncPublicState): void {
    cloudSyncState = next;
    cloudSyncListeners.forEach((listener) => listener(next));
}

export function getMobileCloudSyncState(): CloudSyncPublicState {
    return cloudSyncState;
}

export function subscribeMobileCloudSyncState(listener: (state: CloudSyncPublicState) => void): () => void {
    cloudSyncListeners.add(listener);
    listener(cloudSyncState);
    return () => cloudSyncListeners.delete(listener);
}

/** ログイン中ユーザーのクラウド同期を開始する。環境未設定なら null。 */
export function startMobileCloudSync(userId: string): CloudSyncHandle | null {
    const client = getMobileSupabaseClient();
    if (!client) return null;

    let cache: CloudCache = createEmptyCloudCache();
    let stopped = false;
    const generation = ++cloudSyncGeneration;
    const isAuthSessionCurrent = captureAuthSessionGuard();
    const isCurrent = (): boolean => !stopped && generation === cloudSyncGeneration && isAuthSessionCurrent();
    let pushState = getMobileCloudOutboxState();
    let online: boolean | null = null;
    let manualSync: Promise<void> | null = null;
    let pullState: CloudSyncPublicState['pull'] = { phase: 'idle', lastSuccessAt: null };
    const publish = (): void => {
        if (!isCurrent()) return;
        publishCloudSyncState({
            availability: deriveCloudSyncAvailability(pushState, online),
            push: pushState,
            pull: pullState,
            attention: deriveCloudSyncAttention(pushState, pullState),
        });
    };
    const unsubscribeOutbox = subscribeMobileCloudOutboxState((state) => {
        pushState = state;
        publish();
    });

    const seedStores = async (): Promise<void> => {
        if (!isCurrent()) return;
        if (!Object.values(getSeedableSections(cache)).some(Boolean)) return;
        await rememberMobileCloudDisplayOwner(userId, isCurrent);
        if (!isCurrent()) return;
        if (applyCloudCacheToMobileStores(cache) && isCurrent()) {
            markCloudSessionSeeded();
        }
    };

    const runner = createCloudPullRunner({
        isActive: isCurrent,
        fetchBatch: async (afterVersion, maxVersions) => {
            const { data, error } = await client.rpc('pull_sync_batch', {
                p_after_version: afterVersion,
                p_max_versions: maxVersions,
            });
            if (error) throw new Error(error.message);
            return data as PullBatch;
        },
        applyBatch: async (batch) => {
            if (!isCurrent()) return;
            cache = applyPullBatchToCache(cache, batch);
            await persistCloudCache(AsyncStorage, userId, cache, isCurrent);
            await seedStores();
        },
        readCursor: async () => {
            const raw = await AsyncStorage.getItem(cloudCursorKey(userId));
            const cursor = raw === null ? 0 : Number(raw);
            return Number.isFinite(cursor) && cursor >= 0 ? cursor : 0;
        },
        writeCursor: async (cursor) => {
            if (!isCurrent()) return;
            await AsyncStorage.setItem(cloudCursorKey(userId), String(cursor));
        },
    });

    const pullNow = async (): Promise<void> => {
        if (!isCurrent()) return;
        pullState = { ...pullState, phase: 'pulling' };
        publish();
        try {
            await runner.flush();
            if (!isCurrent()) return;
            pullState = { phase: 'idle', lastSuccessAt: new Date().toISOString() };
            publish();
        } catch {
            if (!isCurrent()) return;
            pullState = { ...pullState, phase: 'failed' };
            publish();
            throw new Error('cloud pull failed');
        }
    };

    const scheduler = createInsurancePullScheduler({
        requestPull: () => { void pullNow().catch(() => undefined); },
    });

    // 再接続時は、古いクラウド状態をpullする前にローカルの保留操作を送る。
    const recoverConnection = async (): Promise<boolean> => {
        if (!isCurrent()) return false;
        const { retryablePending } = await drainOutboxAndWait();
        if (!isCurrent() || retryablePending) return false;
        let pulled = false;
        try {
            await pullNow();
            pulled = true;
        } catch {
            // オフライン時はキャッシュ表示を継続し、次の復帰トリガで再試行する。
        }
        if (pulled && isCurrent()) requestMobileLoginBonusRecheck();
        return isCurrent();
    };

    const channel = client
        .channel(`cloud-sync-${userId}`)
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'sync_versions', filter: `user_id=eq.${userId}` },
            () => { void pullNow().catch(() => undefined); },
        )
        .subscribe();

    const onAppStateChange = (state: AppStateStatus): void => {
        if (!isCurrent()) return;
        if (state === 'active') {
            scheduler.start();
            void recoverConnection().catch(() => undefined);
        } else {
            scheduler.stop(); // バックグラウンドでは定期プルを止める
        }
    };
    const appStateSubscription = AppState.addEventListener('change', onAppStateChange);
    const detectReconnect = createReconnectDetector(() => { void recoverConnection().catch(() => undefined); });
    const netInfoUnsubscribe = NetInfo.addEventListener((state) => {
        if (!isCurrent()) return;
        const next = resolveNetworkOnlineState(state);
        if (next !== null) online = next;
        publish();
        detectReconnect(next);
    });
    scheduler.start();

    // 起動: まずキャッシュから復元（オフラインでも表示）→ 初回プル
    void (async () => {
        cache = await loadCloudCache(AsyncStorage, userId);
        if (!isCurrent()) return;
        // 前回セッションの保留操作があるなら、古いキャッシュで楽観更新を
        // 上書きしない。送信成功後にだけキャッシュを適用する。
        if (await recoverConnection()) await seedStores();
    })().catch(() => undefined);

    publish();
    return {
        isActive: isCurrent,
        flush: () => runner.flush(),
        syncNow: () => {
            if (!isCurrent() || deriveCloudSyncAvailability(pushState, online) !== 'ready') return Promise.resolve();
            if (manualSync) return manualSync;
            const work = (async () => {
                try {
                    await retryPendingOutbox();
                    if (!isCurrent() || deriveCloudSyncAvailability(pushState, online) !== 'ready') return;
                    const state = getMobileCloudOutboxState();
                    if (state.pending > 0 || state.inflight > 0) return;
                    await pullNow();
                } catch {
                    if (!isCurrent()) return;
                    pullState = { ...pullState, phase: 'failed' };
                    publish();
                }
            })();
            manualSync = work;
            void work.then(() => { if (manualSync === work) manualSync = null; });
            return work;
        },
        stop: () => {
            stopped = true;
            unsubscribeOutbox();
            scheduler.stop();
            appStateSubscription.remove();
            netInfoUnsubscribe();
            void client.removeChannel(channel);
            if (generation === cloudSyncGeneration) {
                publishCloudSyncState(createInactiveCloudSyncState());
            }
        },
    };
}

let activeHandle: CloudSyncHandle | null = null;
let activeUserId: string | null = null;

/** テスト用: 現在アクティブな同期ハンドル。 */
export function getActiveMobileCloudSync(): CloudSyncHandle | null {
    return activeHandle;
}

export function syncMobileNow(): Promise<void> {
    return activeHandle?.syncNow() ?? Promise.resolve();
}

/** 退会成功後の専用停止。通常ログアウトと異なり、この後namespaceを破棄する。 */
export function stopMobileCloudSyncForAccountDeletion(): void {
    activeHandle?.stop();
    activeHandle = null;
    activeUserId = null;
}

/** 認証ライフサイクルへクラウド同期を配線する。アプリ起動時に一度だけ呼ぶ。 */
export function registerMobileCloudSyncHooks(): () => void {
    const unregister = registerAuthLifecycleHooks({
        onLogin: (userId) => {
            if (activeUserId === userId && activeHandle?.isActive()) return;
            activeHandle?.stop();
            activeHandle = startMobileCloudSync(userId);
            activeUserId = activeHandle ? userId : null;
        },
        onLogout: () => {
            activeHandle?.stop();
            activeHandle = null;
            activeUserId = null;
        },
    });
    return () => {
        activeHandle?.stop();
        activeHandle = null;
        activeUserId = null;
        unregister();
    };
}
