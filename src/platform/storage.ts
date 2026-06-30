import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware';

export function getWebLocalStorage(): Storage | null {
    try {
        if (typeof window === 'undefined') return null;
        return window.localStorage;
    } catch {
        return null;
    }
}

function getRequiredWebStorage(): StateStorage {
    const storage = getWebLocalStorage();
    if (!storage) {
        throw new Error('Web localStorage is unavailable.');
    }
    return storage;
}

export function createWebPersistStorage<S = unknown>(): PersistStorage<S> | undefined {
    return createJSONStorage<S>(() => getRequiredWebStorage());
}
