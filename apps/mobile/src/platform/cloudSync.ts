/**
 * Mobileのクラウド同期v1（#504、ADR-008/009）。Web版（src/platform/cloudSync.ts）と同型。
 *
 * 保険プルトリガ: 起動 / AppState active復帰 / 定期5分（activeの間のみ）。
 * ネットワーク再接続トリガはAppState復帰で大半が拾えるため、
 * NetInfoによる明示検知はオフラインキュー（#505）と同時に導入する。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import {
    applyPullBatchToCache,
    buildCanonicalGameSnapshot,
    buildCanonicalHabitSnapshot,
    buildCanonicalTaskSnapshot,
    countCloudContentRows,
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
import { markCloudSessionSeeded } from './authStores';
import { seedSectionData } from './canonicalSync';
import { getMobileSupabaseClient } from './supabase';

export interface CloudSyncHandle {
    flush: () => Promise<void>;
    stop: () => void;
}

/** ログイン中ユーザーのクラウド同期を開始する。環境未設定なら null。 */
export function startMobileCloudSync(userId: string): CloudSyncHandle | null {
    const client = getMobileSupabaseClient();
    if (!client) return null;

    let cache: CloudCache = createEmptyCloudCache();
    let stopped = false;

    const seedStores = (): void => {
        // #506の移行が走るまでクラウドは空でありうる。空のままシードすると
        // 未移行のローカルデータを消してしまうため、行が届くまで待つ。
        if (countCloudContentRows(cache) === 0) return;
        seedSectionData('tasks', buildCanonicalTaskSnapshot(cache));
        seedSectionData('habits', buildCanonicalHabitSnapshot(cache));
        const game = buildCanonicalGameSnapshot(cache);
        if (game) seedSectionData('game', game);
        markCloudSessionSeeded();
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

    const scheduler = createInsurancePullScheduler({
        requestPull: () => runner.requestPull(),
    });

    const channel = client
        .channel(`cloud-sync-${userId}`)
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'sync_versions', filter: `user_id=eq.${userId}` },
            () => runner.requestPull(),
        )
        .subscribe();

    const onAppStateChange = (state: AppStateStatus): void => {
        if (state === 'active') {
            scheduler.start();
            scheduler.trigger('foreground');
        } else {
            scheduler.stop(); // バックグラウンドでは定期プルを止める
        }
    };
    const appStateSubscription = AppState.addEventListener('change', onAppStateChange);
    scheduler.start();

    // 起動: まずキャッシュから復元（オフラインでも表示）→ 初回プル
    void (async () => {
        cache = await loadCloudCache(AsyncStorage, userId);
        if (stopped) return;
        seedStores();
        scheduler.trigger('startup');
    })();

    return {
        flush: () => runner.flush(),
        stop: () => {
            stopped = true;
            scheduler.stop();
            appStateSubscription.remove();
            void client.removeChannel(channel);
        },
    };
}

let activeHandle: CloudSyncHandle | null = null;
let activeUserId: string | null = null;

/** テスト用: 現在アクティブな同期ハンドル。 */
export function getActiveMobileCloudSync(): CloudSyncHandle | null {
    return activeHandle;
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
