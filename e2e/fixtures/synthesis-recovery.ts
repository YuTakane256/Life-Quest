// Exercises the Web adapter with disposable storage and a local-only lifecycle identity.
export { captureAuthSessionScope, notifyLogin } from '@life-quest/core/authLifecycle';
export {
    registerSynthesisRecovery, synthesisRecovery, tryAcquireSynthesisSend,
} from '../../src/platform/synthesisRecovery';
