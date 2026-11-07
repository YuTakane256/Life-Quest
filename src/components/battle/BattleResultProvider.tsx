import { registerWebBattleResultRecovery } from '../../platform/battleResultRecovery';
import { useEffect, type ReactNode } from 'react';
import { useMatch } from 'react-router-dom';
import { useCloudBattleResolve } from '../../hooks/useCloudBattleResolve';
import { BattleResultContext } from '../../hooks/useBattleResult';

/** Keep an initiated result's key, action snapshot and lock across routes, without starting elsewhere. */
export function BattleResultProvider({ children }: { children: ReactNode }) {
    const isMapRoute = useMatch('/map') !== null;
    const result = useCloudBattleResolve(isMapRoute);
    useEffect(registerWebBattleResultRecovery, []);
    return <BattleResultContext.Provider value={result}>{children}</BattleResultContext.Provider>;
}
