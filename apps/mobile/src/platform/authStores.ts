/**
 * ログアウト時のストア即時クリア（Mobile側、#503で契約定義、ADR-009）。
 * Webの src/platform/authStores.ts と同型。クラウドデータがシードされた
 * セッションでのみクリアする（未シードならローカル専用データを守る）。
 * 実行中local戦闘の一時runtimeは、画面の有無に関係なく認証世代で隔離する。
 * #504 が pull_sync_batch でシードした時点で markCloudSessionSeeded() を呼ぶ。
 */
import { captureAuthSessionGuard, captureAuthSessionScope, registerAuthLifecycleHooks, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { invalidatePendingHabitEffects, useMobileHabitStore } from '../stores/useMobileHabitStore';
import { discardMobilePendingTaskCompletions, useMobileTaskStore } from '../stores/useMobileTaskStore';
import { useMobileStatsStore } from '../stores/useMobileStatsStore';
import { useMobileTitleStore } from '../stores/useMobileTitleStore';
import { beginMobileLoginBonusCloudSession, clearMobileLoginBonusCloudSession } from '../stores/useMobileLoginBonusStore';
import { hasMobileCloudDisplayOwner, releaseMobileCloudDisplayOwner } from './cloudSessionRecovery';

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
    discardMobilePendingTaskCompletions();
    invalidatePendingHabitEffects();
    useMobileTaskStore.setState({ tasks: [] });
    useMobileHabitStore.setState({ habits: [], records: [], restDays: [], rewardEligibleDates: [] });
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), activeBattle: null, lastLevelUp: null, pendingChestReveal: null });
    useMobileStatsStore.setState({ taskXpLog: {}, habitLog: {}, seeded: false });
    useMobileTitleStore.setState({ activeTitle: null });
}

/** ログアウトフックを登録する。アプリ起動時に一度だけ呼ぶ。 */
export function registerMobileAuthStoreHooks(): () => void {
    // Track the runtime's creation scope even while the map/timer is unmounted.
    const localBattleIdentity = () => {
        const battle = useMobileGameStore.getState().activeBattle;
        return battle?.rewardMode === 'local' && battle.state.outcome === 'ongoing' ? battle.actors : null;
    };
    let localBattle = localBattleIdentity();
    let isCurrentLocalBattleSession = captureAuthSessionGuard();
    const unsubscribeBattle = useMobileGameStore.subscribe(() => {
        const next = localBattleIdentity();
        if (next === localBattle) return; // Turns and unrelated writes keep the original scope.
        localBattle = next;
        isCurrentLocalBattleSession = captureAuthSessionGuard();
    });
    let pendingOwner = captureAuthSessionScope().userId;
    const unsubscribeScope = subscribeAuthSessionScope(({ userId }) => {
        // A preceding subscriber may already have started a battle in the new scope.
        if (localBattle && !isCurrentLocalBattleSession()) useMobileGameStore.getState().clearActiveBattle();
        useMobileGameStore.getState().clearPendingChestReveal();
        const previous = pendingOwner;
        pendingOwner = userId;
        if (previous !== null && previous !== userId) discardMobilePendingTaskCompletions();
    });
    let activeUserId: string | null = null;
    const detachCloudBattle = (): void => {
        const game = useMobileGameStore.getState();
        if (game.activeBattle?.rewardMode === 'cloud') game.clearActiveBattle();
    };
    const unregisterHooks = registerAuthLifecycleHooks({
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
        onLogout: async () => {
            const previousOwner = activeUserId;
            const current = captureAuthSessionScope().isCurrent;
            const hadAccount = activeUserId !== null;
            activeUserId = null;
            clearMobileLoginBonusCloudSession();
            const persistedCloud = previousOwner !== null && await hasMobileCloudDisplayOwner(previousOwner);
            if (!current()) return;
            if (!cloudSessionSeeded && !persistedCloud) {
                if (hadAccount) detachCloudBattle();
                return; // 匿名の移行元データは残す
            }
            clearMobileCloudStores();
            cloudSessionSeeded = false;
            if (previousOwner) await releaseMobileCloudDisplayOwner(previousOwner);
        },
    });
    return () => { unsubscribeBattle(); unsubscribeScope(); unregisterHooks(); };
}
