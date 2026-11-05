import { createContext, useContext } from 'react';
import type { UseCloudChestOpenResult } from './useCloudChestOpen';

export const ChestOperationsContext = createContext<UseCloudChestOpenResult | null>(null);

export function useChestOperations(): UseCloudChestOpenResult {
    const operations = useContext(ChestOperationsContext);
    if (!operations) throw new Error('CharacterScreen requires ChestOperationsProvider');
    return operations;
}
