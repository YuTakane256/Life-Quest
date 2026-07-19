/**
 * タスク完了の5秒Undo待機をタブ非表示・離脱時に即時確定する。
 *
 * Undoタイマーは非永続（タブが閉じられると失われる）ため、5秒以内に
 * タブを閉じる/離脱すると「完了表示のまま報酬RPC・complete_task未送信」
 * となり、次のクラウドプルで未完了へ巻き戻る。Mobileの
 * apps/mobile/src/platform/pendingCompletionFlush.ts（AppState購読）の
 * Web版で、visibilitychange（hidden）とpagehideの両方で確定させる
 * （pagehideはタブを閉じる瞬間もvisibilitychangeより確実に発火する）。
 */
import { useTaskStore } from '../stores/useTaskStore';

/** アプリ起動時に一度だけ呼ぶ。戻り値で解除できる。 */
export function registerPendingCompletionFlush(): () => void {
    const flush = (): void => {
        useTaskStore.getState().flushPendingCompletions();
    };
    const onVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', flush);
    };
}
