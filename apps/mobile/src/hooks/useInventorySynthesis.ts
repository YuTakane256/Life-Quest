import { createContext, useContext } from 'react';
import type { UseCloudItemSynthesisResult } from './useCloudItemSynthesis';

export const InventoryOperationsContext = createContext<UseCloudItemSynthesisResult | null>(null);

export function useInventorySynthesis() {
    const operations = useContext(InventoryOperationsContext);
    if (!operations) throw new Error('InventoryScreen requires InventoryOperationsProvider');
    return operations;
}
