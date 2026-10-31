import { createContext, useContext } from 'react';
import type { UseCloudItemSynthesisResult } from './useCloudItemSynthesis';

export const InventoryOperationsContext = createContext<UseCloudItemSynthesisResult | null>(null);

export function useInventorySynthesis(): UseCloudItemSynthesisResult {
    const operations = useContext(InventoryOperationsContext);
    if (!operations) throw new Error('Inventory requires InventoryOperationsProvider');
    return operations;
}
