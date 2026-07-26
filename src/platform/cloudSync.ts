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
import { registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
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
    createCloudPullRunner,
    createInsurancePullScheduler,
    type PullBatch,
} from '@life-quest/core/cloudPull';
import { markCloudSessionSeeded } from './authStores';
import { seedGame, seedHabits, seedTasks } from './canonicalSync';
import { getPlatformStorageAdapter } from './storage';
import { getWebSupabaseClient } from './supabase';
import { drainOutboxAndWait } from './cloudOutbox';
import { resolveHabitReminderHour } from '../core/notifications';
import { useStatsStore } from '../stores/useStatsStore';
import { useThemeStore, sanitizeThemeMode } from '../stores/useThemeStore';
import { useMotionStore, sanitizeMotionMode } from '../stores/useMotionStore';
import { useNotificationStore } from '../stores/useNotificationStore';
import { requestLoginBonusRecheck } from '../stores/useLoginBonusStore';

export interface CloudSyncHandle {
    /** 実行中のプルの完了を待つ（テスト用） */
    flush: () => Promise<void>;
    /** 購読・タイマーを全て止める */
    stop: () => void;
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
            seedGame(game);
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

    const seedStores = (): void => {
        if (applyCloudCacheToWebStores(cache)) {
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

    // 楽観更新が残ったままpullすると、古いクラウド状態で一時的に上書きされうる。
    // 再接続・フォアグラウンド復帰ではoutboxを先に空にしてからpullを要求する。
    const recoverConnection = async (): Promise<boolean> => {
        const { retryablePending } = await drainOutboxAndWait();
        if (stopped || retryablePending) return false;
        scheduler.trigger('reconnect');
        let pulled = false;
        try {
            await runner.flush();
            pulled = true;
        } catch {
            // オフライン時はキャッシュ表示を継続し、次の復帰トリガで再試行する。
        }
        // 同期が成功した復帰時だけ未請求ボーナスを再確認する。ストア側の
        // 世代・in-flightゲートが複数トリガの重複を吸収する。
        if (pulled && !stopped) requestLoginBonusRecheck();
        return !stopped;
    };

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
            void recoverConnection();
        } else {
            scheduler.stop(); // バックグラウンドでは定期プルを止める
        }
    };
    const onOnline = (): void => { void recoverConnection(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    scheduler.start();

    // 起動: まずキャッシュから復元（オフラインでも表示）→ 初回プル
    void (async () => {
        cache = await loadCloudCache(storage, userId);
        if (stopped) return;
        // pending outboxがある間は、前回のクラウドキャッシュで楽観更新を
        // 上書きしない。送信成功後にのみキャッシュを反映する。
        if (await recoverConnection()) seedStores();
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
