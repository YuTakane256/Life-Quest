import type { ReactNode } from 'react';
import { useCloudBattleStart } from '../../hooks/useCloudBattleStart';
import { BattleStartContext } from '../../hooks/useBattleStart';

/** Retain an explicit start's stage/key and lock within this App/auth session across routes. */
export function BattleStartProvider({ children }: { children: ReactNode }) {
    const operations = useCloudBattleStart();
    return <BattleStartContext.Provider value={operations}>{children}</BattleStartContext.Provider>;
}
