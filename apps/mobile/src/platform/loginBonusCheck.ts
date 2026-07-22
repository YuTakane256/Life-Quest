/**
 * デイリーログインボーナスの判定トリガー。Web `App.tsx`の起動時チェックに対応。
 * 起動時・フォアグラウンド復帰時にcheckDailyLoginを呼ぶ
 * （`notifications.ts`のregisterNotificationChecksと同一のAppState規約）。
 */
import { AppState, type AppStateStatus } from 'react-native';
import { useMobileLoginBonusStore } from '../stores/useMobileLoginBonusStore';

/** 起動時に一度だけ呼ぶ。戻り値で解除できる。 */
export function registerLoginBonusCheck(): () => void {
    useMobileLoginBonusStore.getState().checkDailyLogin();

    const onChange = (state: AppStateStatus): void => {
        if (state === 'active') useMobileLoginBonusStore.getState().checkDailyLogin();
    };
    const subscription = AppState.addEventListener('change', onChange);

    return () => {
        subscription.remove();
    };
}
