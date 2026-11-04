import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useCloudBattleResolve } from '../../hooks/useCloudBattleResolve';
import { BattleResultContext } from '../../hooks/useBattleResult';

/** Keep an initiated result's key, action snapshot and lock across routes, without starting elsewhere. */
export function BattleResultProvider({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const result = useCloudBattleResolve(pathname === '/map');
    return <BattleResultContext.Provider value={result}>{children}</BattleResultContext.Provider>;
}
