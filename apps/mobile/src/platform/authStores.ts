/**
 * ログアウト時のストア即時クリア（Mobile側、#503で契約定義、ADR-009）。
 * Webの src/platform/authStores.ts と同型。クラウドデータがシードされた
 * セッションでのみクリアする（未シードならローカル専用データを守る）。
 * #504 が pull_sync_batch でシードした時点で markCloudSessionSeeded() を呼ぶ。
 */
import { registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { invalidatePendingHabitEffects, useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';
import { useMobileStatsStore } from '../stores/useMobileStatsStore';
import { useMobileTitleStore } from '../stores/useMobileTitleStore';
import { beginMobileLoginBonusCloudSession, clearMobileLoginBonusCloudSession } from '../stores/useMobileLoginBonusStore';

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
    invalidatePendingHabitEffects();
    useMobileTaskStore.setState({ tasks: [] });
    useMobileHabitStore.setState({ habits: [], records: [], restDays: [], rewardEligibleDates: [] });
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), activeBattle: null, lastLevelUp: null });
    useMobileStatsStore.setState({ taskXpLog: {}, habitLog: {}, seeded: false });
    useMobileTitleStore.setState({ activeTitle: null });
}

/** ログアウトフックを登録する。アプリ起動時に一度だけ呼ぶ。 */
export function registerMobileAuthStoreHooks(): () => void {
    let activeUserId: string | null = null;
    const detachCloudBattle = (): void => {
        const game = useMobileGameStore.getState();
        if (game.activeBattle?.rewardMode === 'cloud') game.clearActiveBattle();
    };
    return registerAuthLifecycleHooks({
        onLogin: (userId) => {
            // Keep anonymous migration data and same-user refreshes, but never let
            // B's migration/sync hooks read A's already-seeded display cache.
            const switchedAccount = activeUserId !== null && activeUserId !== userId;
            const switchedSeededAccount = switchedAccount && cloudSessionSeeded;
            if (switchedAccount && !cloudSessionSeeded) detachCloudBattle();
            activeUserId = userId;
            if (switchedSeededAccount) {
                clearMobileCloudStores();
                cloudSessionSeeded = false;
            }
            beginMobileLoginBonusCloudSession(userId);
        },
        onLogout: () => {
            const hadAccount = activeUserId !== null;
            activeUserId = null;
            clearMobileLoginBonusCloudSession();
            if (!cloudSessionSeeded) {
                if (hadAccount) detachCloudBattle();
                return; // 匿名の移行元データは残す
            }
            clearMobileCloudStores();
            cloudSessionSeeded = false;
        },
    });
}
