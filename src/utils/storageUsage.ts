const APP_STORAGE_PREFIX = 'quest-board-';

export interface StorageUsage {
    available: boolean;
    bytes: number;
    itemCount: number;
}

function estimateStorageBytes(value: string): number {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(value).length;
    }
    return value.length * 2;
}

export function getAppStorageUsage(storage: Storage | null | undefined = globalThis.localStorage): StorageUsage {
    if (!storage) return { available: false, bytes: 0, itemCount: 0 };

    try {
        let bytes = 0;
        let itemCount = 0;

        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (!key || !key.startsWith(APP_STORAGE_PREFIX)) continue;

            const value = storage.getItem(key) ?? '';
            bytes += estimateStorageBytes(key) + estimateStorageBytes(value);
            itemCount++;
        }

        return { available: true, bytes, itemCount };
    } catch {
        return { available: false, bytes: 0, itemCount: 0 };
    }
}

export function formatStorageBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
