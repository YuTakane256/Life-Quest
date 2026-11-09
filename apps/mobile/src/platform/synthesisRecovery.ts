import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSynthesisRecovery, synthesisRecoveryKey } from '@life-quest/core/synthesisRecovery';

export const synthesisRecovery = createSynthesisRecovery({ storage: AsyncStorage });
export const registerSynthesisRecovery = synthesisRecovery.register;

// The UI can be remounted or switch auth generation while a native request is still running.
const sendingOwners = new Set<string>();
export function tryAcquireSynthesisSend(userId: string): (() => void) | null {
    if (sendingOwners.has(userId)) return null;
    sendingOwners.add(userId);
    return () => { sendingOwners.delete(userId); };
}

/** After confirmed deletion, finish the owner-specific cleanup even if the UI switches accounts. */
export async function retireMobileSynthesisRecovery(userId: string) {
    await synthesisRecovery.retire(userId);
    await AsyncStorage.removeItem(synthesisRecoveryKey(userId));
}
