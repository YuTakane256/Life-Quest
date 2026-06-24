const APP_STORAGE_PREFIX = 'quest-board-';
const STORAGE_WARNING_BYTES = 1024 * 1024;
const STORAGE_CRITICAL_BYTES = 4 * 1024 * 1024;

export type StorageUsageLevel = 'ok' | 'warning' | 'critical' | 'unavailable';

export interface StorageUsage {
    available: boolean;
    bytes: number;
    itemCount: number;
    level: StorageUsageLevel;
}

function estimateUtf16Bytes(value: string): number {
    return value.length * 2;
}

export function getAppStorageUsage(storage: Storage | null | undefined = globalThis.localStorage): StorageUsage {
    if (!storage) return { available: false, bytes: 0, itemCount: 0, level: 'unavailable' };

    try {
        let bytes = 0;
        let itemCount = 0;

        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (!key || !key.startsWith(APP_STORAGE_PREFIX)) continue;

            const value = storage.getItem(key) ?? '';
            bytes += estimateUtf16Bytes(key) + estimateUtf16Bytes(value);
            itemCount++;
        }

        return { available: true, bytes, itemCount, level: classifyStorageUsage(bytes) };
    } catch {
        return { available: false, bytes: 0, itemCount: 0, level: 'unavailable' };
    }
}

export function classifyStorageUsage(bytes: number): StorageUsageLevel {
    if (!Number.isFinite(bytes) || bytes < 0) return 'unavailable';
    if (bytes >= STORAGE_CRITICAL_BYTES) return 'critical';
    if (bytes >= STORAGE_WARNING_BYTES) return 'warning';
    return 'ok';
}

export function formatStorageBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatStorageUsageLevel(level: StorageUsageLevel): string {
    if (level === 'critical') return '危険';
    if (level === 'warning') return '注意';
    if (level === 'ok') return 'OK';
    return '利用不可';
}
