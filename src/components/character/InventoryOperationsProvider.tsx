import type { ReactNode } from 'react';
import { useCloudItemSynthesis } from '../../hooks/useCloudItemSynthesis';
import { InventoryOperationsContext } from '../../hooks/useInventorySynthesis';

/** Keep one synthesis operation and its retry identity across inventory/character route changes. */
export function InventoryOperationsProvider({ children }: { children: ReactNode }) {
    const operations = useCloudItemSynthesis();
    return <InventoryOperationsContext.Provider value={operations}>{children}</InventoryOperationsContext.Provider>;
}
