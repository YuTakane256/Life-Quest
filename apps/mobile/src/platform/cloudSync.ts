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
import { registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import {
    applyPullBatchToCache,
    createEmptyCloudCache,
    loadCloudCache,
    persistCloudCache,
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
    type CloudSyncPublicState,
} from '@life-quest/core/cloudSyncState';
import { markCloudSessionSeeded } from './authStores';
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
    let pushState = getMobileCloudOutboxState();
    let pullState: CloudSyncPublicState['pull'] = { phase: 'idle', lastSuccessAt: null };
    const publish = (): void => {
        if (stopped || generation !== cloudSyncGeneration) return;
        publishCloudSyncState({
            availability: pushState.availability === 'inactive' ? 'inactive' : 'ready',
            push: pushState,
            pull: pullState,
            attention: deriveCloudSyncAttention(pushState, pullState),
        });
    };
    const unsubscribeOutbox = subscribeMobileCloudOutboxState((state) => {
        pushState = state;
        publish();
    });

    const seedStores = (): void => {
        if (applyCloudCacheToMobileStores(cache)) {
            markCloudSessionSeeded();
        }
    };

    const runner = createCloudPullRunner({
        fetchBatch: async (afterVersion, maxVersions) => {
            const { data, error } = await client.rpc('pull_sync_batch', {
                p_after_version: afterVersion,
                p_max_versions: maxVersions,
            });
            if (error) throw new Error(error.message);
            return data as PullBatch;
        },
        applyBatch: async (batch) => {
            cache = applyPullBatchToCache(cache, batch);
            await persistCloudCache(AsyncStorage, userId, cache);
            seedStores();
        },
        readCursor: async () => {
            const raw = await AsyncStorage.getItem(cloudCursorKey(userId));
            const cursor = raw === null ? 0 : Number(raw);
            return Number.isFinite(cursor) && cursor >= 0 ? cursor : 0;
        },
        writeCursor: async (cursor) => {
            await AsyncStorage.setItem(cloudCursorKey(userId), String(cursor));
        },
    });

    const pullNow = async (): Promise<void> => {
        if (stopped) return;
        pullState = { ...pullState, phase: 'pulling' };
        publish();
        try {
            await runner.flush();
            if (stopped) return;
            pullState = { phase: 'idle', lastSuccessAt: new Date().toISOString() };
            publish();
        } catch {
            if (stopped) return;
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
        const { retryablePending } = await drainOutboxAndWait();
        if (stopped || retryablePending) return false;
        let pulled = false;
        try {
            await pullNow();
            pulled = true;
        } catch {
            // オフライン時はキャッシュ表示を継続し、次の復帰トリガで再試行する。
        }
        if (pulled && !stopped) requestMobileLoginBonusRecheck();
        return !stopped;
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
        detectReconnect(resolveNetworkOnlineState(state));
    });
    scheduler.start();

    // 起動: まずキャッシュから復元（オフラインでも表示）→ 初回プル
    void (async () => {
        cache = await loadCloudCache(AsyncStorage, userId);
        if (stopped) return;
        // 前回セッションの保留操作があるなら、古いキャッシュで楽観更新を
        // 上書きしない。送信成功後にだけキャッシュを適用する。
        if (await recoverConnection()) seedStores();
    })().catch(() => undefined);

    publish();
    return {
        flush: () => runner.flush(),
        syncNow: async () => {
            await retryPendingOutbox();
            const state = getMobileCloudOutboxState();
            if (state.pending > 0 || state.inflight > 0) return;
            try {
                await pullNow();
            } catch {
                // 失敗状態は公開済み。UIイベントへ未処理のPromiseを返さない。
            }
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
            if (activeUserId === userId && activeHandle) return;
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
