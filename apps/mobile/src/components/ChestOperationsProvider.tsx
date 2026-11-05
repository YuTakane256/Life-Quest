import type { ReactNode } from 'react';
import { useCloudChestOpen } from '../hooks/useCloudChestOpen';
import { ChestOperationsContext } from '../hooks/useChestOperations';

/** Keep retry identity and the opening lock within this App/auth session across screen recreation. */
export function ChestOperationsProvider({ children }: { children: ReactNode }) {
    const operations = useCloudChestOpen();
    return <ChestOperationsContext.Provider value={operations}>{children}</ChestOperationsContext.Provider>;
}
