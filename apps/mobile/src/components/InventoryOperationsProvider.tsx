import type { ReactNode } from 'react';
import { useCloudItemSynthesis } from '../hooks/useCloudItemSynthesis';
import { InventoryOperationsContext } from '../hooks/useInventorySynthesis';

/** Keep retry IDs across screen unmounts, as the former retained character tab did. */
export function InventoryOperationsProvider({ children }: { children: ReactNode }) {
    const operations = useCloudItemSynthesis();
    return <InventoryOperationsContext.Provider value={operations}>{children}</InventoryOperationsContext.Provider>;
}
