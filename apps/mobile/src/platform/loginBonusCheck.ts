/**
 * デイリーログインボーナスの判定トリガー。Web `App.tsx`の起動時チェックに対応。
 * 起動時・フォアグラウンド復帰時にcheckDailyLoginを呼ぶ
 * （`notifications.ts`のregisterNotificationChecksと同一のAppState規約）。
 */
import { AppState, type AppStateStatus } from 'react-native';
import { useMobileLoginBonusStore } from '../stores/useMobileLoginBonusStore';
import { useMobileGameStore } from '../stores/useMobileGameStore';

/** 起動時に一度だけ呼ぶ。戻り値で解除できる。 */
export function registerLoginBonusCheck(): () => void {
    let stopped = false;
    const check = (): void => {
        if (!stopped) void useMobileLoginBonusStore.getState().checkDailyLogin();
    };

    // AsyncStorageとゲームストアの復元が終わるまで請求しない。復元後に一度だけ
    // 走らせ、以降は通常の起動・復帰トリガーで再確認する。
    const tryInitialCheck = (): void => {
        if (useMobileLoginBonusStore.persist.hasHydrated() && useMobileGameStore.getState().hasHydrated) check();
    };
    tryInitialCheck();
    const unsubscribeGame = useMobileGameStore.subscribe((state, previous) => {
        if (state.hasHydrated && !previous.hasHydrated) tryInitialCheck();
    });
    const unsubscribeBonusHydration = useMobileLoginBonusStore.persist.onFinishHydration(() => tryInitialCheck());

    const onChange = (state: AppStateStatus): void => {
        if (state === 'active') useMobileLoginBonusStore.getState().checkDailyLogin();
    };
    const subscription = AppState.addEventListener('change', onChange);

    return () => {
        stopped = true;
        subscription.remove();
        unsubscribeGame();
        unsubscribeBonusHydration();
    };
}
