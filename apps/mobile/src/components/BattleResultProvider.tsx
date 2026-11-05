import type { ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { useCloudBattleResolve } from '../hooks/useCloudBattleResolve';
import { BattleResultContext } from '../hooks/useBattleResult';

/** Retain an initiated result across screens; start new automatic sends on the map only. */
export function BattleResultProvider({ children }: { children: ReactNode }) {
    const isMapRoute = usePathname() === '/map';
    const result = useCloudBattleResolve(isMapRoute);
    return <BattleResultContext.Provider value={result}>{children}</BattleResultContext.Provider>;
}
