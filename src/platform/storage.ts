import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware';
import {
    createUnavailableStorageAdapter,
    createWebStorageAdapter,
    createZustandStateStorage,
    type PlatformStorageAdapter,
    type SyncPlatformStorageAdapter,
} from './storageAdapter';

export function getWebLocalStorage(): Storage | null {
    try {
        if (typeof window === 'undefined') return null;
        return window.localStorage;
    } catch {
        return null;
    }
}

export function createWebLocalStorageAdapter(): SyncPlatformStorageAdapter {
    return createWebStorageAdapter(getWebLocalStorage());
}

export function getPlatformStorageAdapter(): PlatformStorageAdapter {
    const storage = getWebLocalStorage();
    return storage ? createWebStorageAdapter(storage) : createUnavailableStorageAdapter();
}

function createWebStateStorage(): StateStorage {
    return createZustandStateStorage(getPlatformStorageAdapter());
}

export function createWebPersistStorage<S = unknown>(): PersistStorage<S> | undefined {
    return createJSONStorage<S>(() => createWebStateStorage());
}
