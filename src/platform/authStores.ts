/**
 * ログアウト時のストア即時クリア（#503で契約定義、ADR-009）。
 *
 * クラウド同期対象ストア（tasks/habits/game/title）を、ログアウトの一部として
 * メモリ上で即座に初期状態へ戻す。別アカウントへの切り替えで前ユーザーの
 * データが画面・送信内容に残留することを防ぐ。
 *
 * 重要な但し書き（#503時点の挙動）:
 * クリアは「クラウドデータがストアへシードされたセッション」でのみ行う。
 * #503の時点ではログインしてもクラウドデータはまだストアへ入らない（同期は#504）ため、
 * 無条件にクリアすると persist 経由でローカル専用データ（quest-board-*）まで
 * 消してしまう。#504 が pull_sync_batch でストアをシードした時点で
 * markCloudSessionSeeded() を呼び、それ以降のログアウトでクリアが働く。
 */
import { registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { sanitizeGameStoreState, useGameStore } from '../stores/useGameStore';
import { sanitizeHabitStoreState, useHabitStore } from '../stores/useHabitStore';
import { sanitizeTaskStoreState, useTaskStore } from '../stores/useTaskStore';
import { useTitleStore } from '../stores/useTitleStore';

let cloudSessionSeeded = false;

/** #504がクラウドデータをストアへシードした直後に呼ぶ。 */
export function markCloudSessionSeeded(): void {
    cloudSessionSeeded = true;
}

/** テスト用。 */
export function resetCloudSessionSeeded(): void {
    cloudSessionSeeded = false;
}

/** クラウド同期対象の全Webストアをメモリ上で初期状態へ戻す。 */
export function clearWebCloudStores(): void {
    useTaskStore.setState({ ...sanitizeTaskStoreState(undefined), pendingCompletions: [] });
    useHabitStore.setState(sanitizeHabitStoreState(undefined));
    useGameStore.setState({
        ...sanitizeGameStoreState(undefined),
        levelUpEvent: null,
        pendingChestReveal: null,
    });
    useTitleStore.setState({ activeTitle: null });
}

/**
 * ログアウトフックを登録する。アプリ起動時に一度だけ呼ぶ。
 * 戻り値で解除できる（テスト用）。
 */
export function registerWebAuthStoreHooks(): () => void {
    return registerAuthLifecycleHooks({
        onLogout: () => {
            if (!cloudSessionSeeded) return; // クラウド未シードならローカルデータを守る
            clearWebCloudStores();
            cloudSessionSeeded = false;
        },
    });
}
