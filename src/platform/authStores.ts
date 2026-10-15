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
import { invalidatePendingHabitEffects, sanitizeHabitStoreState, useHabitStore } from '../stores/useHabitStore';
import { sanitizeTaskStoreState, useTaskStore } from '../stores/useTaskStore';
import { useTitleStore } from '../stores/useTitleStore';
import { beginLoginBonusCloudSession, clearLoginBonusCloudSession } from '../stores/useLoginBonusStore';
import { flushCompletionRewardWrites, resetCompletionRewardStorage, withCompletionRewardLock, withoutCompletionRewardPersistence } from './completionRewards';
import { getWebLocalStorage } from './storage';
import { generateId } from '../utils/dateUtils';

let cloudSessionSeeded = false;

export const CLOUD_SESSION_RECOVERY_PREFIX = 'life-quest:cloud-session-recovery:v1:';

export function hasPersistedCloudGame(): boolean {
    try {
        const raw = getWebLocalStorage()?.getItem('quest-board-game');
        return Boolean(raw && JSON.parse(raw)?.state?.completionRewardScope === 'cloud');
    } catch {
        // Corrupt/unavailable storage is not a reason to clear unknown data.
        // The game storage/reward paths preserve it and report the save failure.
        return false;
    }
}

/** No valid session after restart: archive the cloud cache before isolating anonymous progress. */
export async function prepareWebAnonymousSession(shouldContinue: () => boolean = () => true): Promise<void> {
    try {
        await flushCompletionRewardWrites();
        if (!shouldContinue() || !hasPersistedCloudGame()) return;
        let archived = false;
        await withCompletionRewardLock(() => {
            if (!shouldContinue() || !hasPersistedCloudGame()) return;
            const storage = getWebLocalStorage();
            if (!storage) throw new Error('保存領域を利用できません。');
            const slots = Object.fromEntries(['quest-board-game', 'quest-board-tasks', 'quest-board-habits', 'quest-board-title']
                .map((key) => [key, storage.getItem(key)]));
            // Do not overwrite older recovery copies. If this write fails, keep the original cache.
            storage.setItem(`${CLOUD_SESSION_RECOVERY_PREFIX}${generateId()}`, JSON.stringify({
                version: 1, archivedAt: new Date().toISOString(), slots,
            }));
            archived = true;
        });
        if (!archived || !shouldContinue()) return;
        clearLoginBonusCloudSession();
        clearWebCloudStores();
        await flushCompletionRewardWrites();
        if (shouldContinue() && hasPersistedCloudGame()) throw new Error('匿名用の保存状態へ切り替えられません。');
        cloudSessionSeeded = false;
    } catch (error) {
        withoutCompletionRewardPersistence(() => useGameStore.setState({
            completionRewardError: '匿名状態への切り替えを保存できません。保存環境を確認するか、再ログインしてください。クラウドのキャッシュは退避前に削除しません。',
        }));
        throw error;
    }
}

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
    invalidatePendingHabitEffects();
    useTaskStore.setState({ ...sanitizeTaskStoreState(undefined), pendingCompletions: [] });
    useHabitStore.setState(sanitizeHabitStoreState(undefined));
    resetCompletionRewardStorage(() => useGameStore.setState({
        ...sanitizeGameStoreState(undefined),
        levelUpEvent: null,
        pendingChestReveal: null,
        completionRewardError: null,
    }));
    useTitleStore.setState({ activeTitle: null });
}

/**
 * ログアウトフックを登録する。アプリ起動時に一度だけ呼ぶ。
 * 戻り値で解除できる（テスト用）。
 */
export function registerWebAuthStoreHooks(): () => void {
    return registerAuthLifecycleHooks({
        onLogin: (userId) => {
            // クラウド同期の開始より先に、前アカウントの演出・失敗状態を隔離する。
            beginLoginBonusCloudSession(userId);
        },
        onLogout: () => {
            // cloudSessionSeededの有無に関係なくログインボーナスはアカウント固有。
            clearLoginBonusCloudSession();
            if (!cloudSessionSeeded) return; // クラウド未シードならローカルデータを守る
            clearWebCloudStores();
            cloudSessionSeeded = false;
            return flushCompletionRewardWrites();
        },
    });
}
