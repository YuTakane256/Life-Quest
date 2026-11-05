import { createContext, useContext } from 'react';
import type { UseCloudBattleResolveResult } from './useCloudBattleResolve';

export const BattleResultContext = createContext<UseCloudBattleResolveResult | null>(null);

export function useBattleResult(): UseCloudBattleResolveResult {
    const result = useContext(BattleResultContext);
    if (!result) throw new Error('Map requires BattleResultProvider');
    return result;
}
