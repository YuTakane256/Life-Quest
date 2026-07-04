/**
 * ログアウト時のストア即時クリア（Mobile側、#503で契約定義、ADR-009）。
 * Webの src/platform/authStores.ts と同型。クラウドデータがシードされた
 * セッションでのみクリアする（未シードならローカル専用データを守る）。
 * #504 が pull_sync_batch でシードした時点で markCloudSessionSeeded() を呼ぶ。
 */
import { registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';

let cloudSessionSeeded = false;

/** #504がクラウドデータをストアへシードした直後に呼ぶ。 */
export function markCloudSessionSeeded(): void {
    cloudSessionSeeded = true;
}

/** テスト用。 */
export function resetCloudSessionSeeded(): void {
    cloudSessionSeeded = false;
}

/** クラウド同期対象の全Mobileストアをメモリ上で初期状態へ戻す。 */
export function clearMobileCloudStores(): void {
    useMobileTaskStore.setState({ tasks: [] });
    useMobileHabitStore.setState({ habits: [], records: [], restDays: [], rewardEligibleDates: [] });
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), lastLevelUp: null });
}

/** ログアウトフックを登録する。アプリ起動時に一度だけ呼ぶ。 */
export function registerMobileAuthStoreHooks(): () => void {
    return registerAuthLifecycleHooks({
        onLogout: () => {
            if (!cloudSessionSeeded) return; // クラウド未シードならローカルデータを守る
            clearMobileCloudStores();
            cloudSessionSeeded = false;
        },
    });
}
