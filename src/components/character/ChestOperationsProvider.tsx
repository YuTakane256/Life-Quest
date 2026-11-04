import type { ReactNode } from 'react';
import { useCloudChestOpen } from '../../hooks/useCloudChestOpen';
import { ChestOperationsContext } from '../../hooks/useChestOperations';

/** Keep chest retry keys and the opening lock within this App/auth session across route changes. */
export function ChestOperationsProvider({ children }: { children: ReactNode }) {
    const operations = useCloudChestOpen();
    return <ChestOperationsContext.Provider value={operations}>{children}</ChestOperationsContext.Provider>;
}
