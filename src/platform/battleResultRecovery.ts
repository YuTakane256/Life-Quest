import { captureAuthSessionScope } from '@life-quest/core/authLifecycle';
import { battleResultRecoveryKey, createBattleResultRecovery } from '@life-quest/core/battleResultRecovery';
import { getWebLocalStorage } from './storage';
const storage = () => { const value = getWebLocalStorage(); if (!value) throw new Error('保存領域を利用できません。'); return value; };
export const canSaveBattleResult = () => typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
export const battleResultRecovery = createBattleResultRecovery({
    storage: { getItem: (key) => storage().getItem(key), setItem: (key, value) => storage().setItem(key, value), removeItem: (key) => storage().removeItem(key) },
    withLock: (userId, work) => {
        if (!canSaveBattleResult()) return Promise.reject(new Error('安全な保存にはWeb Locks対応ブラウザーが必要です。'));
        return navigator.locks.request(battleResultRecoveryKey(userId), work);
    },
    send: async (record, isActive) => {
        const [{ getGameAuthState }, { resolveCloudBattleAttempt }] = await Promise.all([import('./auth'), import('./gameCloud')]);
        const auth = await getGameAuthState();
        if (!isActive() || auth.kind !== 'authenticated' || auth.userId !== record.userId) throw new Error('ログイン状態を確認してください。');
        return resolveCloudBattleAttempt(record.attemptId, record.actions, { expectedUserId: record.userId, idempotencyKey: record.key, isActive });
    },
    onResolved: async () => {
        const { getActiveWebCloudSync } = await import('./cloudSync');
        await getActiveWebCloudSync()?.syncNow();
    },
});

export function registerWebBattleResultRecovery() {
    const off = battleResultRecovery.register();
    const receive = (event: StorageEvent) => {
        const { userId } = captureAuthSessionScope();
        if (userId && event.key === battleResultRecoveryKey(userId)) void battleResultRecovery.load();
    };
    window.addEventListener('storage', receive);
    return () => { window.removeEventListener('storage', receive); off(); };
}
