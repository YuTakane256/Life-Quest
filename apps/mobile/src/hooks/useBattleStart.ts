import { createContext, useContext } from 'react';
import type { useCloudBattleStart } from './useCloudBattleStart';

type BattleStartOperations = ReturnType<typeof useCloudBattleStart>;
export const BattleStartContext = createContext<BattleStartOperations | null>(null);

export function useBattleStart(): BattleStartOperations {
    const operations = useContext(BattleStartContext);
    if (!operations) throw new Error('Map requires BattleStartProvider');
    return operations;
}
