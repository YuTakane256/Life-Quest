import { captureAuthSessionScope, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';
import { battleResultRecoveryKey, createBattleResultRecovery, type BattleResultRecoveryState } from '@life-quest/core/battleResultRecovery';
import { canLockWebRecovery, retireWebRecoveryKey, tryAcquireWebRecoveryLock, webRecoveryStorage, withWebRecoveryLock } from './webRecoveryStorage';

export const canSaveBattleResult = canLockWebRecovery;

export const battleResultRecovery = createBattleResultRecovery({
    storage: webRecoveryStorage,
    withLock: (userId, work) => withWebRecoveryLock(userId, battleResultRecoveryKey(userId), work),
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

export async function retireWebBattleResultRecovery(userId: string) {
    await battleResultRecovery.retire(userId);
    await retireWebRecoveryKey(userId, battleResultRecoveryKey(userId));
}

export function registerWebBattleResultRecovery() {
    const off = battleResultRecovery.register();
    const receive = (event: StorageEvent) => {
        const { userId } = captureAuthSessionScope();
        if (userId && event.key === battleResultRecoveryKey(userId)) void battleResultRecovery.load();
    };
    window.addEventListener('storage', receive);
    return () => { window.removeEventListener('storage', receive); off(); };
}

/** An owner can have one live Web battle or one recovery operation per browser origin. */
export function tryAcquireWebBattleSession(userId: string): Promise<(() => void) | null> {
    return tryAcquireWebRecoveryLock(`${battleResultRecoveryKey(userId)}:session`);
}

export async function withWebBattleRecoverySession(snapshot: BattleResultRecoveryState, work: () => Promise<unknown>) {
    const scope = captureAuthSessionScope();
    if (!scope.userId || scope.userId !== snapshot.userId) return false;
    const release = await tryAcquireWebBattleSession(scope.userId);
    if (!release) return false;
    if (!scope.isCurrent() || battleResultRecovery.getState() !== snapshot) {
        release();
        return true;
    }
    const stop = () => {
        offAuth();
        offRecovery();
        release();
    };
    const offAuth = subscribeAuthSessionScope(stop);
    const offRecovery = battleResultRecovery.subscribe(() => {
        const state = battleResultRecovery.getState();
        if (state.userId !== scope.userId || state.phase !== 'ready') return;
        const original = snapshot.pending;
        if (!state.pending || (original && (state.pending.attemptId !== original.attemptId || state.pending.key !== original.key))) stop();
    });
    try {
        await work();
        return true;
    } finally {
        stop();
    }
}
