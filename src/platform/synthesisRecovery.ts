import { captureAuthSessionScope } from '@life-quest/core/authLifecycle';
import { createSynthesisRecovery, synthesisRecoveryKey } from '@life-quest/core/synthesisRecovery';
import { canLockWebRecovery, retireWebRecoveryKey, tryAcquireWebRecoveryLock, webRecoveryStorage, withWebRecoveryLock } from './webRecoveryStorage';

export const synthesisRecovery = createSynthesisRecovery({
    storage: webRecoveryStorage,
    withLock: (owner, work) => withWebRecoveryLock(owner, synthesisRecoveryKey(owner), work),
});

export function registerSynthesisRecovery() {
    const stop = synthesisRecovery.register();
    const onStorage = (event: StorageEvent) => {
        const { userId } = captureAuthSessionScope();
        if (userId && (event.key === null || event.key === synthesisRecoveryKey(userId))) void synthesisRecovery.load();
    };
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('storage', onStorage); stop(); };
}

export const canSaveSynthesis = canLockWebRecovery;
export const tryAcquireSynthesisSend = (userId: string) => tryAcquireWebRecoveryLock(`${synthesisRecoveryKey(userId)}:send`);

export async function retireWebSynthesisRecovery(userId: string) {
    await synthesisRecovery.retire(userId);
    await retireWebRecoveryKey(userId, synthesisRecoveryKey(userId));
}
