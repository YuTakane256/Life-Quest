import { createContext, useContext } from 'react';
import type { UseCloudBattleStartResult } from './useCloudBattleStart';

export const BattleStartContext = createContext<UseCloudBattleStartResult | null>(null);

export function useBattleStart(): UseCloudBattleStartResult {
    const operations = useContext(BattleStartContext);
    if (!operations) throw new Error('Map requires BattleStartProvider');
    return operations;
}
