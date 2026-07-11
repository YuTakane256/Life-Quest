/**
 * タスク完了の5秒Undo待機をバックグラウンド遷移時に即時確定する（#512）。
 *
 * Undoタイマーは非永続（プロセス消滅で失われる）ため、5秒以内にアプリが
 * killされると「完了表示のまま報酬RPC未送信」となり、次のクラウドプルで
 * 未完了へ巻き戻る。Mobileはバックグラウンド遷移が頻繁なため、activeを
 * 離れる時点で待機中の完了を全て確定して取りこぼしを防ぐ。
 *
 * ストア本体にreact-nativeをimportするとユニットテストがFlow構文で
 * 壊れるため、AppState購読はこのモジュールに分離している。
 */
import { AppState, type AppStateStatus } from 'react-native';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';

/** アプリ起動時に一度だけ呼ぶ。戻り値で解除できる。 */
export function registerPendingCompletionFlush(): () => void {
    const onChange = (state: AppStateStatus): void => {
        if (state !== 'active') {
            useMobileTaskStore.getState().flushPendingCompletions();
        }
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
}
