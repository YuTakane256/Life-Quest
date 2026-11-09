import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSynthesisRecovery } from '@life-quest/core/synthesisRecovery';

export const synthesisRecovery = createSynthesisRecovery({ storage: AsyncStorage });
export const registerSynthesisRecovery = synthesisRecovery.register;
