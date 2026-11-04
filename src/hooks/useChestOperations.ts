import { createContext, useContext } from 'react';
import type { UseCloudChestOpenResult } from './useCloudChestOpen';

export const ChestOperationsContext = createContext<UseCloudChestOpenResult | null>(null);

export function useChestOperations(): UseCloudChestOpenResult {
    const operations = useContext(ChestOperationsContext);
    if (!operations) throw new Error('Character requires ChestOperationsProvider');
    return operations;
}
