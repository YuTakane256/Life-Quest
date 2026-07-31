import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccountCloudData, runAccountDeletionCleanup } from '@life-quest/core/accountDeletion';
import { clearMobileCloudStores, resetCloudSessionSeeded } from './authStores';
import { stopMobileOutboxForAccountDeletion } from './cloudOutbox';
import { stopMobileCloudSyncForAccountDeletion } from './cloudSync';
import { useMobileStatsStore } from '../stores/useMobileStatsStore';
import { useMobileLoginBonusStore } from '../stores/useMobileLoginBonusStore';
import { useMobileTitleStore } from '../stores/useMobileTitleStore';

/** サーバー削除成功後だけ実行する、Mobile専用の非破壊クリーンアップ。 */
export async function cleanupDeletedMobileAccount(userId: string): Promise<void> {
    await runAccountDeletionCleanup({
        stopSync: stopMobileCloudSyncForAccountDeletion,
        stopOutbox: stopMobileOutboxForAccountDeletion,
        removeCloudData: () => deleteAccountCloudData(AsyncStorage, userId),
        resetMemory: () => {
            clearMobileCloudStores();
            useMobileStatsStore.setState({ taskXpLog: {}, habitLog: {} });
            useMobileTitleStore.setState({ activeTitle: null });
            useMobileLoginBonusStore.getState().clearPendingBonus();
            resetCloudSessionSeeded();
        },
    });
}
