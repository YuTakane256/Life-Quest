// Exercises the real browser adapter with a disposable lifecycle identity and no backend.
export { captureAuthSessionScope, notifyLogin } from '@life-quest/core/authLifecycle';
export { battleResultRecoveryKey } from '@life-quest/core/battleResultRecovery';
export {
    battleResultRecovery,
    retireWebBattleResultRecovery,
    tryAcquireWebBattleSession,
    withWebBattleRecoverySession,
} from '../../src/platform/battleResultRecovery';
export { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
