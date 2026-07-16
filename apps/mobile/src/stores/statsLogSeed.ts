/**
 * 統計ログ（useMobileStatsStore）の初回シード。
 *
 * タスク・習慣ストアとは別々のAsyncStorageキーに永続化されるため、
 * rewardSync.ts と同じ「各ストアのhydration完了を購読し、揃った時点で実行する」
 * パターンでシードする。seedIfNeeded自体はシード済みなら何もしない冪等関数。
 *
 * 新規端末インストール直後にクラウドログインした場合、ここでの各ストア
 * ハイドレーションはクラウドプル完了より早く終わるため、ローカルコレクションが
 * 空のまま空ログがシード（seeded: true）される。このシードは以後「クラウドに
 * 一切データが無いアカウント」向けのフォールバックとしてのみ機能し、
 * 実際の復元は cloudSeed.ts の applyCloudCacheToMobileStores が呼ぶ
 * mergeFromCloud（stats_daily由来の単調マージ）が担う。
 */
import { useMobileHabitStore } from './useMobileHabitStore';
import { useMobileStatsStore } from './useMobileStatsStore';
import { useMobileTaskStore } from './useMobileTaskStore';

function trySeed(): void {
    const stats = useMobileStatsStore.getState();
    if (!stats.hasHydrated || stats.seeded) return;

    const taskState = useMobileTaskStore.getState();
    const habitState = useMobileHabitStore.getState();
    if (!taskState.hasHydrated || !habitState.hasHydrated) return;

    stats.seedIfNeeded(taskState.tasks, habitState.habits, habitState.records);
}

/**
 * 各ストアのhydration完了を監視し、揃い次第シードを試みる。
 * アプリのルートで一度だけ呼ぶ。テスト用に購読解除関数を返す。
 */
export function startStatsLogSeed(): () => void {
    trySeed();

    const unsubscribes = [
        useMobileStatsStore.subscribe((state, previous) => {
            if (state.hasHydrated && !previous.hasHydrated) trySeed();
        }),
        useMobileTaskStore.subscribe((state, previous) => {
            if (state.hasHydrated && !previous.hasHydrated) trySeed();
        }),
        useMobileHabitStore.subscribe((state, previous) => {
            if (state.hasHydrated && !previous.hasHydrated) trySeed();
        }),
    ];

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}
