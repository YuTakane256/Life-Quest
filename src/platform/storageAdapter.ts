import type { StateStorage } from 'zustand/middleware';

export type StorageAdapterResult<T> = T | Promise<T>;

export interface PlatformStorageAdapter {
    getItem: (key: string) => StorageAdapterResult<string | null>;
    setItem: (key: string, value: string) => StorageAdapterResult<void>;
    removeItem: (key: string) => StorageAdapterResult<void>;
}

export interface SyncPlatformStorageAdapter extends PlatformStorageAdapter {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
}

export function createUnavailableStorageAdapter(): PlatformStorageAdapter {
    return {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
    };
}

export function createWebStorageAdapter(storage: Storage | null | undefined): SyncPlatformStorageAdapter {
    if (!storage) {
        return createUnavailableStorageAdapter() as SyncPlatformStorageAdapter;
    }

    return {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => {
            storage.setItem(key, value);
        },
        removeItem: (key) => {
            storage.removeItem(key);
        },
    };
}

export function createZustandStateStorage(adapter: PlatformStorageAdapter): StateStorage {
    return {
        getItem: adapter.getItem,
        setItem: adapter.setItem,
        removeItem: adapter.removeItem,
    };
}
