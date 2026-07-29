import { deleteAccountCloudData, runAccountDeletionCleanup } from '@life-quest/core/accountDeletion';
import { clearWebCloudStores, resetCloudSessionSeeded } from './authStores';
import { stopWebOutboxForAccountDeletion } from './cloudOutbox';
import { stopWebCloudSyncForAccountDeletion } from './cloudSync';
import { getPlatformStorageAdapter } from './storage';
import { useStatsStore, sanitizeStatsStoreState } from '../stores/useStatsStore';
import { useLoginBonusStore } from '../stores/useLoginBonusStore';
import { useTitleStore } from '../stores/useTitleStore';

/**
 * サーバー削除成功後だけ呼ぶ端末側後始末。ユーザーnamespace以外を削除しない。
 * 先に送信・購読を止めるため、削除したキューが再生成されない。
 */
export async function cleanupDeletedWebAccount(userId: string): Promise<void> {
    await runAccountDeletionCleanup({
        stopSync: stopWebCloudSyncForAccountDeletion,
        stopOutbox: stopWebOutboxForAccountDeletion,
        removeCloudData: () => deleteAccountCloudData(getPlatformStorageAdapter(), userId),
        resetMemory: () => {
            clearWebCloudStores();
            useStatsStore.setState(sanitizeStatsStoreState(undefined));
            useTitleStore.setState({ activeTitle: null });
            useLoginBonusStore.getState().clearPendingBonus();
            resetCloudSessionSeeded();
        },
    });
}
