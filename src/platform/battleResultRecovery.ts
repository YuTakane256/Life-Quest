import { captureAuthSessionScope, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';
import { battleResultRecoveryKey, createBattleResultRecovery, type BattleResultRecoveryState } from '@life-quest/core/battleResultRecovery';
import { getWebLocalStorage } from './storage';
const storage = () => { const value = getWebLocalStorage(); if (!value) throw new Error('保存領域を利用できません。'); return value; };
export const canSaveBattleResult = () => typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
// Keep only an irreversible identifier so a stale tab cannot recreate deleted data.
const retirementIndex = 'life-quest:battle-result-retirements:v1';
async function retirementKey(userId: string) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
    const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${retirementIndex}:${hex}`;
}

export const battleResultRecovery = createBattleResultRecovery({
    storage: { getItem: (key) => storage().getItem(key), setItem: (key, value) => storage().setItem(key, value), removeItem: (key) => storage().removeItem(key) },
    withLock: (userId, work) => {
        if (!canSaveBattleResult()) return Promise.reject(new Error('安全な保存にはWeb Locks対応ブラウザーが必要です。'));
        return navigator.locks.request(battleResultRecoveryKey(userId), async () => {
            if (storage().getItem(retirementIndex) && storage().getItem(await retirementKey(userId))) {
                throw new Error('削除済みアカウントの戦闘結果は保存できません。');
            }
            return work();
        });
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

export async function retireWebBattleResultRecovery(userId: string) {
    await battleResultRecovery.retire(userId);
    if (!canSaveBattleResult()) return;
    await navigator.locks.request(battleResultRecoveryKey(userId), async () => {
        const retired = await retirementKey(userId);
        const local = storage();
        local.removeItem(battleResultRecoveryKey(userId));
        local.setItem(retirementIndex, '1');
        local.setItem(retired, '1');
    });
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
    return new Promise((acquired) => {
        if (!canSaveBattleResult()) { acquired(null); return; }
        void navigator.locks.request(`${battleResultRecoveryKey(userId)}:session`, { ifAvailable: true }, (lock) => {
            if (!lock) { acquired(null); return; }
            return new Promise<void>((release) => { acquired(release); });
        }).catch(() => acquired(null));
    });
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
        if (state.userId === scope.userId && state.phase === 'ready' && !state.pending) stop();
    });
    try {
        await work();
        return true;
    } finally {
        stop();
    }
}
