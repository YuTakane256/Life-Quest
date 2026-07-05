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
 * クラウドが空（コンテンツ行ゼロ）の間はストアへシードしない。
 * 空クラウドでローカルデータを消さないため。
 */
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
import { seedGame, seedHabits, seedTasks } from './canonicalSync';
import { getPlatformStorageAdapter } from './storage';
import { getWebSupabaseClient } from './supabase';

export interface CloudSyncHandle {
    /** 実行中のプルの完了を待つ（テスト用） */
    flush: () => Promise<void>;
    /** 購読・タイマーを全て止める */
    stop: () => void;
}

/** ログイン中ユーザーのクラウド同期を開始する。環境未設定なら null。 */
export function startWebCloudSync(userId: string): CloudSyncHandle | null {
    const client = getWebSupabaseClient();
    if (!client) return null;
    const storage = getPlatformStorageAdapter();

    let cache: CloudCache = createEmptyCloudCache();
    let stopped = false;

    const seedStores = (): void => {
        // #506の移行が走るまでクラウドは空でありうる。空のままシードすると
        // 未移行のローカルデータを消してしまうため、行が届くまで待つ。
        if (countCloudContentRows(cache) === 0) return;
        seedTasks(buildCanonicalTaskSnapshot(cache));
        seedHabits(buildCanonicalHabitSnapshot(cache));
        const game = buildCanonicalGameSnapshot(cache);
        if (game) seedGame(game);
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
            await persistCloudCache(storage, userId, cache);
            seedStores();
        },
        readCursor: async () => {
            const raw = await storage.getItem(cloudCursorKey(userId));
            const cursor = raw === null ? 0 : Number(raw);
            return Number.isFinite(cursor) && cursor >= 0 ? cursor : 0;
        },
        writeCursor: async (cursor) => {
            await storage.setItem(cloudCursorKey(userId), String(cursor));
        },
    });

    const scheduler = createInsurancePullScheduler({
        requestPull: () => runner.requestPull(),
    });

    // Realtime: 全書き込み操作が必ずsync_versionsをUPDATEするため、1購読で全変更を検知できる
    const channel = client
        .channel(`cloud-sync-${userId}`)
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'sync_versions', filter: `user_id=eq.${userId}` },
            () => runner.requestPull(),
        )
        .subscribe();

    const onVisibilityChange = (): void => {
        if (document.visibilityState === 'visible') {
            scheduler.start();
            scheduler.trigger('foreground');
        } else {
            scheduler.stop(); // バックグラウンドでは定期プルを止める
        }
    };
    const onOnline = (): void => scheduler.trigger('online');
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    scheduler.start();

    // 起動: まずキャッシュから復元（オフラインでも表示）→ 初回プル
    void (async () => {
        cache = await loadCloudCache(storage, userId);
        if (stopped) return;
        seedStores();
        scheduler.trigger('startup');
    })();

    return {
        flush: () => runner.flush(),
        stop: () => {
            stopped = true;
            scheduler.stop();
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('online', onOnline);
            void client.removeChannel(channel);
        },
    };
}

let activeHandle: CloudSyncHandle | null = null;
let activeUserId: string | null = null;

/** テスト用: 現在アクティブな同期ハンドル。 */
export function getActiveWebCloudSync(): CloudSyncHandle | null {
    return activeHandle;
}

/**
 * 認証ライフサイクルへクラウド同期を配線する。アプリ起動時に一度だけ呼ぶ。
 * onLoginで同期開始（TOKEN_REFRESH等の重複通知は無視）、onLogoutで停止する。
 */
export function registerWebCloudSyncHooks(): () => void {
    const unregister = registerAuthLifecycleHooks({
        onLogin: (userId) => {
            if (activeUserId === userId && activeHandle) return;
            activeHandle?.stop();
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
