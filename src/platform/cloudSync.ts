/**
 * Webのクラウド同期v1（#504、ADR-008/009）。
 *
 * - pull_sync_batch を has_more まで消化し、user_id別namespaceの
 *   カーソル・キャッシュへ保存してからストアへシードする
 * - Realtime は sync_versions 1行のUPDATE購読のみ（通知専用）。
 *   実データは必ず pull_sync_batch で取る
 * - 保険プル4トリガ: 起動 / visibilitychange(visible) / online / 定期5分
 * - ログアウト時は購読・タイマーを止める（ストアのメモリ即時クリアは
 *   authStores のフックが行う）
 *
 * #506（ローカルデータのクラウド取り込み）が入るまでの保護:
 * セクション単位で「クラウドが正か」を判定し（getSeedableSections）、
 * 初期行しか無いクラウド状態で既存ローカルデータを消さない。
 */
import { captureAuthSessionGuard, registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import {
    applyPullBatchToCache,
    buildCanonicalGameSnapshot,
    buildCanonicalHabitSnapshot,
    buildCanonicalTaskSnapshot,
    buildStatsLogSnapshot,
    createEmptyCloudCache,
    extractSyncedSettings,
    getSeedableSections,
    loadCloudCache,
    persistCloudCache,
    type CloudCache,
} from '@life-quest/core/cloudCache';
import {
    cloudCursorKey,
    CloudPullAuthError,
    createAccountBoundCloudPullFetcher,
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
import { seedGame, seedHabits, seedTasks } from './canonicalSync';
import { getPlatformStorageAdapter } from './storage';
import { getWebSupabaseClient } from './supabase';
import {
    drainOutboxAndWait,
    getWebCloudOutboxState,
    retryPendingOutbox,
    subscribeWebCloudOutboxState,
} from './cloudOutbox';
import { resolveHabitReminderHour } from '../core/notifications';
import { useStatsStore } from '../stores/useStatsStore';
import { useThemeStore, sanitizeThemeMode } from '../stores/useThemeStore';
import { useMotionStore, sanitizeMotionMode } from '../stores/useMotionStore';
import { useNotificationStore } from '../stores/useNotificationStore';
import { requestLoginBonusRecheck } from '../stores/useLoginBonusStore';

export interface CloudSyncHandle {
    /** 同じuserIdでも、途中のログアウト通知で無効になったハンドルは再利用しない。 */
    isActive: () => boolean;
    /** 実行中のプルの完了を待つ（テスト用） */
    flush: () => Promise<void>;
    /** 購読・タイマーを全て止める */
    stop: () => void;
    /** 保留操作の送信と通常の差分pullを行う。恒久失敗は変更しない。 */
    syncNow: () => Promise<void>;
}

let cloudSyncState: CloudSyncPublicState = createInactiveCloudSyncState();
const cloudSyncListeners = new Set<(state: CloudSyncPublicState) => void>();
let cloudSyncGeneration = 0;

function publishCloudSyncState(next: CloudSyncPublicState): void {
    cloudSyncState = next;
    cloudSyncListeners.forEach((listener) => listener(next));
}

export function getWebCloudSyncState(): CloudSyncPublicState {
    return cloudSyncState;
}

export function subscribeWebCloudSyncState(listener: (state: CloudSyncPublicState) => void): () => void {
    cloudSyncListeners.add(listener);
    listener(cloudSyncState);
    return () => cloudSyncListeners.delete(listener);
}

/**
 * クラウドキャッシュを「クラウドが正と言えるセクションだけ」ストアへ反映する。
 * #506の移行前は初期行（characters version=1等）しか無いため、その状態で
 * 空のtasks/habitsや初期値のゲーム状態をシードして既存ローカルデータを
 * 消さないよう、セクション単位で判定する（core getSeedableSections）。
 * 1つ以上シードした場合のみtrueを返す。
 */
export function applyCloudCacheToWebStores(cache: CloudCache): boolean {
    const seedable = getSeedableSections(cache);
    let seeded = false;
    if (seedable.tasks) {
        seedTasks(buildCanonicalTaskSnapshot(cache));
        seeded = true;
    }
    if (seedable.habits) {
        seedHabits(buildCanonicalHabitSnapshot(cache));
        seeded = true;
    }
    if (seedable.game) {
        const game = buildCanonicalGameSnapshot(cache);
        if (game) {
            seedGame(game, 'cloud');
            seeded = true;
        }
    }
    // 統計ログはtasks/habitsのようなクラウド優先シードではなく単調マージ（削除済みデータの
    // 実績を後退させない）。空のクラウドとのマージは何度呼んでもno-opなので毎回呼んで良い。
    if (Object.keys(cache.stats_daily).length > 0) {
        useStatsStore.getState().mergeFromCloud(buildStatsLogSnapshot(cache));
    }
    if (seedable.settings) {
        const settings = extractSyncedSettings(cache);
        if (settings) {
            // setState直接呼び出し（set系アクション経由ではない）ため、
            // syncSettingsToCloudへの再送信は起きない（seedTasks等と同じ設計）。
            // notifiedTaskIds/lastHabitReminderDateはここで一切触れない。
            useThemeStore.setState({ mode: sanitizeThemeMode(settings.themeMode) });
            useMotionStore.setState({ mode: sanitizeMotionMode(settings.motionMode) });
            useNotificationStore.setState({
                enabled: settings.notificationsEnabled === true,
                habitReminderHour: resolveHabitReminderHour(settings.habitReminderHour),
            });
            seeded = true;
        }
    }
    return seeded;
}

/** ログイン中ユーザーのクラウド同期を開始する。環境未設定なら null。 */
export function startWebCloudSync(userId: string): CloudSyncHandle | null {
    const client = getWebSupabaseClient();
    if (!client) return null;
    const storage = getPlatformStorageAdapter();

    let cache: CloudCache = createEmptyCloudCache();
    let stopped = false;
    const generation = ++cloudSyncGeneration;
    // Invalidate at notification start, not only once later sync hooks reach stop().
    const isAuthSessionCurrent = captureAuthSessionGuard();
    const isCurrent = (): boolean => !stopped && generation === cloudSyncGeneration && isAuthSessionCurrent();
    // localStorage is shared by tabs, while `cache` belongs to this handle.
    // A different tab's saved cursor does not prove that this cache received its rows.
    // Rebuild from version 0 once per handle (also repairs missing/stale saved sections),
    // then advance only through batches this handle actually applied.
    let appliedCursor = 0;
    const cacheReady = loadCloudCache(storage, userId).then((restored) => {
        if (isCurrent()) cache = restored;
    }).catch(() => { /* A full pull can rebuild the cache when storage becomes available. */ });
    let pushState = getWebCloudOutboxState();
    let online: boolean | null = typeof navigator === 'undefined' ? null : navigator.onLine;
    let manualSync: Promise<void> | null = null;
    let pullState: CloudSyncPublicState['pull'] = { phase: 'idle', lastSuccessAt: null };
    const publish = (): void => {
        if (!isCurrent()) return;
        publishCloudSyncState({
            availability: deriveCloudSyncAvailability(pushState, online, pullState),
            push: pushState,
            pull: pullState,
            attention: deriveCloudSyncAttention(pushState, pullState),
        });
    };
    const unsubscribeOutbox = subscribeWebCloudOutboxState((state) => {
        pushState = state;
        publish();
    });

    const seedStores = (): void => {
        if (!isCurrent()) return;
        if (applyCloudCacheToWebStores(cache) && isCurrent()) {
            markCloudSessionSeeded();
        }
    };

    const runner = createCloudPullRunner({
        isActive: isCurrent,
        fetchBatch: createAccountBoundCloudPullFetcher({
            expectedUserId: userId,
            isActive: isCurrent,
            getSession: async () => {
                const { data, error } = await client.auth.getSession();
                if (error) throw new Error('cloud pull authentication unavailable');
                if (!data.session) return null;
                return { userId: data.session.user.id, accessToken: data.session.access_token };
            },
            call: async (afterVersion, maxVersions, token) => {
                const { data, error, status } = await client.rpc('pull_sync_batch', {
                    p_after_version: afterVersion,
                    p_max_versions: maxVersions,
                }).setHeader('Authorization', `Bearer ${token}`);
                if (status === 401) throw new CloudPullAuthError('request');
                if (error) throw new Error('cloud pull request failed');
                return data as PullBatch;
            },
        }),
        applyBatch: async (batch) => {
            if (!isCurrent()) return;
            cache = applyPullBatchToCache(cache, batch);
            await persistCloudCache(storage, userId, cache, isCurrent);
            seedStores();
        },
        readCursor: async () => {
            // A manual/realtime pull must not be overwritten by a later startup load.
            await cacheReady;
            return appliedCursor;
        },
        writeCursor: async (cursor) => {
            if (!isCurrent()) return;
            appliedCursor = cursor;
            // Keep the existing key compatible, without trusting another tab's value.
            await storage.setItem(cloudCursorKey(userId), String(cursor));
        },
    });

    const pullNow = async (): Promise<void> => {
        if (!isCurrent() || pullState.phase === 'auth-required') return;
        pullState = { ...pullState, phase: 'pulling' };
        publish();
        try {
            await runner.flush();
            if (!isCurrent()) return;
            pullState = { phase: 'idle', lastSuccessAt: new Date().toISOString() };
            publish();
        } catch (error) {
            if (!isCurrent()) return;
            pullState = { ...pullState, phase: error instanceof CloudPullAuthError ? 'auth-required' : 'failed' };
            publish();
            if (error instanceof CloudPullAuthError) throw error;
            // eslint-disable-next-line preserve-caught-error -- Raw SDK/storage diagnostics must not survive as error.cause.
            throw new Error('cloud pull failed');
        }
    };

    // 楽観更新が残ったままpullすると、古いクラウド状態で一時的に上書きされうる。
    // Realtime・定期処理を含む全ての自動トリガでoutboxを先に処理する。
    const recoverConnection = async (): Promise<boolean> => {
        if (!isCurrent() || deriveCloudSyncAvailability(pushState, online, pullState) === 'auth-required') return false;
        const { retryablePending } = await drainOutboxAndWait();
        if (!isCurrent() || retryablePending || deriveCloudSyncAvailability(pushState, online, pullState) === 'auth-required') return false;
        let pulled = false;
        try {
            await pullNow();
            pulled = true;
        } catch {
            // オフライン時はキャッシュ表示を継続し、次の復帰トリガで再試行する。
        }
        // 同期が成功した復帰時だけ未請求ボーナスを再確認する。ストア側の
        // 世代・in-flightゲートが複数トリガの重複を吸収する。
        if (pulled && isCurrent()) requestLoginBonusRecheck();
        return isCurrent();
    };

    const scheduler = createInsurancePullScheduler({
        requestPull: () => { void recoverConnection().catch(() => undefined); },
    });

    // Realtime: 全書き込み操作が必ずsync_versionsをUPDATEするため、1購読で全変更を検知できる
    const channel = client
        .channel(`cloud-sync-${userId}`)
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'sync_versions', filter: `user_id=eq.${userId}` },
            () => { void recoverConnection().catch(() => undefined); },
        )
        .subscribe();

    const onVisibilityChange = (): void => {
        if (!isCurrent()) return;
        if (document.visibilityState === 'visible') {
            scheduler.start();
            void recoverConnection().catch(() => undefined);
        } else {
            scheduler.stop(); // バックグラウンドでは定期プルを止める
        }
    };
    const onOnline = (): void => {
        if (!isCurrent()) return;
        online = true;
        publish();
        void recoverConnection().catch(() => undefined);
    };
    const onOffline = (): void => { if (isCurrent()) { online = false; publish(); } };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    scheduler.start();

    // 起動: まずキャッシュから復元（オフラインでも表示）→ 初回プル
    void (async () => {
        await cacheReady;
        if (!isCurrent()) return;
        // pending outboxがある間は、前回のクラウドキャッシュで楽観更新を
        // 上書きしない。送信成功後にのみキャッシュを反映する。
        if (await recoverConnection()) seedStores();
    })().catch(() => undefined);

    publish();
    return {
        isActive: isCurrent,
        flush: () => runner.flush(),
        syncNow: () => {
            if (!isCurrent() || deriveCloudSyncAvailability(pushState, online, pullState) !== 'ready') return Promise.resolve();
            if (manualSync) return manualSync;
            const work = (async () => {
                try {
                    await retryPendingOutbox();
                    if (!isCurrent() || deriveCloudSyncAvailability(pushState, online, pullState) !== 'ready') return;
                    const state = getWebCloudOutboxState();
                    if (state.pending > 0 || state.inflight > 0) return;
                    await pullNow();
                } catch (error) {
                    if (!isCurrent()) return;
                    pullState = { ...pullState, phase: error instanceof CloudPullAuthError ? 'auth-required' : 'failed' };
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
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
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
export function getActiveWebCloudSync(): CloudSyncHandle | null {
    return activeHandle;
}

/** 設定画面から呼ぶ、安全な同期。恒久失敗・競合の破棄や再送はしない。 */
export function syncWebNow(): Promise<void> {
    return activeHandle?.syncNow() ?? Promise.resolve();
}

/** 退会成功後の専用停止。通常ログアウトと異なり、この後namespaceを破棄する。 */
export function stopWebCloudSyncForAccountDeletion(): void {
    activeHandle?.stop();
    activeHandle = null;
    activeUserId = null;
}

/**
 * 認証ライフサイクルへクラウド同期を配線する。アプリ起動時に一度だけ呼ぶ。
 * onLoginで同期開始（TOKEN_REFRESH等の重複通知は無視）、onLogoutで停止する。
 */
export function registerWebCloudSyncHooks(): () => void {
    const unregister = registerAuthLifecycleHooks({
        onLogin: (userId) => {
            // Only a blocked pull needs a fresh handle on same-owner authentication.
            if (activeUserId === userId && activeHandle?.isActive()
                && getWebCloudSyncState().pull.phase !== 'auth-required') return;
            activeHandle?.stop();
            activeHandle = startWebCloudSync(userId);
            activeUserId = activeHandle ? userId : null;
        },
        onTokenRefreshed: (userId) => {
            if (activeUserId !== userId || !activeHandle?.isActive()
                || getWebCloudSyncState().pull.phase !== 'auth-required') return;
            activeHandle.stop();
            activeHandle = startWebCloudSync(userId);
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
