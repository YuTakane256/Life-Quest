import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBattleResultRecovery } from '@life-quest/core/battleResultRecovery';
export const battleResultRecovery = createBattleResultRecovery({
    storage: AsyncStorage,
    send: async (record, isActive) => {
        const [{ getGameAuthState }, { resolveCloudBattleAttempt }] = await Promise.all([import('./auth'), import('./battleCloud')]);
        const auth = await getGameAuthState();
        if (!isActive() || auth.kind !== 'authenticated' || auth.userId !== record.userId) throw new Error('ログイン状態を確認してください。');
        return resolveCloudBattleAttempt(record.attemptId, record.actions, { expectedUserId: record.userId, idempotencyKey: record.key, isActive });
    },
    onResolved: async () => {
        const { getActiveMobileCloudSync } = await import('./cloudSync');
        await getActiveMobileCloudSync()?.syncNow();
    },
});
