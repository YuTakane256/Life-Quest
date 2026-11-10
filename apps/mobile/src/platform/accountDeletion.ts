import { retireMobileSynthesisRecovery } from './synthesisRecovery';
import { battleResultRecovery } from './battleResultRecovery';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccountCloudData, runAccountDeletionCleanup } from '@life-quest/core/accountDeletion';
import { clearMobileCloudStores, resetCloudSessionSeeded } from './authStores';
import { stopMobileOutboxForAccountDeletion } from './cloudOutbox';
import { stopMobileCloudSyncForAccountDeletion } from './cloudSync';
import { useMobileLoginBonusStore } from '../stores/useMobileLoginBonusStore';
import { releaseMobileCloudDisplayOwner } from './cloudSessionRecovery';

/** サーバー削除成功後だけ実行する、Mobile専用の非破壊クリーンアップ。 */
export async function cleanupDeletedMobileAccount(userId: string, isCurrent: () => boolean = () => true): Promise<void> {
    await runAccountDeletionCleanup({
        isCurrent,
        stopSync: stopMobileCloudSyncForAccountDeletion,
        stopOutbox: async () => {
            const results = await Promise.allSettled([battleResultRecovery.retire(userId), retireMobileSynthesisRecovery(userId)]);
            if (isCurrent()) await stopMobileOutboxForAccountDeletion();
            const rejected = results.find((result) => result.status === 'rejected');
            if (rejected) throw rejected.reason;
        },
        removeCloudData: () => deleteAccountCloudData(AsyncStorage, userId),
        resetMemory: async () => {
            clearMobileCloudStores();
            useMobileLoginBonusStore.getState().clearPendingBonus();
            resetCloudSessionSeeded();
            await releaseMobileCloudDisplayOwner(userId);
        },
    });
}
