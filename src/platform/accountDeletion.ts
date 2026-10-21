import { deleteAccountCloudData, runAccountDeletionCleanup } from '@life-quest/core/accountDeletion';
import { clearWebCloudStores, resetCloudSessionSeeded } from './authStores';
import { stopWebOutboxForAccountDeletion } from './cloudOutbox';
import { stopWebCloudSyncForAccountDeletion } from './cloudSync';
import { getPlatformStorageAdapter } from './storage';
import { useLoginBonusStore } from '../stores/useLoginBonusStore';

/**
 * サーバー削除成功後だけ呼ぶ端末側後始末。ユーザーnamespace以外を削除しない。
 * 先に送信・購読を止めるため、削除したキューが再生成されない。
 */
export async function cleanupDeletedWebAccount(userId: string, isCurrent: () => boolean = () => true): Promise<void> {
    await runAccountDeletionCleanup({
        isCurrent,
        stopSync: stopWebCloudSyncForAccountDeletion,
        stopOutbox: stopWebOutboxForAccountDeletion,
        removeCloudData: () => deleteAccountCloudData(getPlatformStorageAdapter(), userId),
        resetMemory: () => {
            clearWebCloudStores();
            useLoginBonusStore.getState().clearPendingBonus();
            resetCloudSessionSeeded();
        },
    });
}
