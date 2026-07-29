import type { Priority } from '../types';
import { getWebLocalStorage } from './storage';

export interface PendingWebRewardOperation {
    key: string;
    priority: Priority;
    completedAt: string;
    xpReward: number;
}

let activeUserId: string | null = null;
const operations = new Map<string, PendingWebRewardOperation>();

export function pendingWebRewardOperationsKey(userId: string): string {
    return `life-quest:cloud:${userId}:pending-reward-operations:v1`;
}

function deserialize(raw: string | null): PendingWebRewardOperation[] {
    if (!raw) return [];
    try {
        const value: unknown = JSON.parse(raw);
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is PendingWebRewardOperation => (
            typeof item === 'object' && item !== null
            && typeof (item as { key?: unknown }).key === 'string'
            && typeof (item as { priority?: unknown }).priority === 'string'
            && typeof (item as { completedAt?: unknown }).completedAt === 'string'
            && typeof (item as { xpReward?: unknown }).xpReward === 'number'
        ));
    } catch {
        return [];
    }
}

function persist(): void {
    if (!activeUserId) return;
    const storage = getWebLocalStorage();
    if (!storage) throw new Error('localStorage is unavailable');
    storage.setItem(pendingWebRewardOperationsKey(activeUserId), JSON.stringify([...operations.values()]));
}

export function restorePendingWebRewardOperations(userId: string): void {
    if (activeUserId && activeUserId !== userId) operations.clear();
    activeUserId = userId;
    const storage = getWebLocalStorage();
    const stored = deserialize(storage?.getItem(pendingWebRewardOperationsKey(userId)) ?? null);
    for (const operation of stored) operations.set(operation.key, operation);
    persist();
}

export function deferWebRewardOperation(operation: PendingWebRewardOperation): void {
    operations.set(operation.key, operation);
    try {
        persist();
    } catch {
        // メモリには残す。次の認証確定または同一セッションの再試行で回復する。
    }
}

export function getPendingWebRewardOperations(): PendingWebRewardOperation[] {
    return [...operations.values()];
}

export function removePendingWebRewardOperation(key: string): void {
    const current = operations.get(key);
    if (!current) return;
    operations.delete(key);
    try {
        persist();
    } catch (error) {
        operations.set(key, current);
        throw error;
    }
}

/** ログアウト時は現在のメモリキューだけを切り離し、user namespaceの保存キーは残す。 */
export function detachPendingWebRewardOperations(): void {
    activeUserId = null;
    operations.clear();
}

/** テスト用。端末保存は個別に消去する。 */
export function clearPendingWebRewardOperations(): void {
    detachPendingWebRewardOperations();
}
