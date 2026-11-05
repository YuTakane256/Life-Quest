import type { ReactNode } from 'react';
import { useCloudBattleStart } from '../hooks/useCloudBattleStart';
import { BattleStartContext } from '../hooks/useBattleStart';

/** Keep the explicit start's stage/key and lock within this root/auth session. */
export function BattleStartProvider({ children }: { children: ReactNode }) {
    const operations = useCloudBattleStart();
    return <BattleStartContext.Provider value={operations}>{children}</BattleStartContext.Provider>;
}
