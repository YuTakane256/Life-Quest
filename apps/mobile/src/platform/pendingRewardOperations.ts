import AsyncStorage from '@react-native-async-storage/async-storage';

/** 認証復元中に完了した操作だけを保持する、user namespace付き端末キュー。 */
export type PendingRewardOperation =
    | { kind: 'complete_task'; taskId: string }
    | { kind: 'complete_subtask'; taskId: string; subtaskId: string };

let activeUserId: string | null = null;
let suppressNextAnonymousRecovery = false;
const operations = new Map<string, PendingRewardOperation>();

export function pendingRewardOperationsKey(userId: string): string {
    return `life-quest:cloud:${userId}:pending-reward-operations:v1`;
}

function operationKey(operation: PendingRewardOperation): string {
    return operation.kind === 'complete_task'
        ? `task:${operation.taskId}`
        : `subtask:${operation.subtaskId}`;
}

function deserialize(raw: string | null): PendingRewardOperation[] {
    if (!raw) return [];
    try {
        const value: unknown = JSON.parse(raw);
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is PendingRewardOperation => (
            typeof item === 'object' && item !== null
            && ((item as { kind?: unknown }).kind === 'complete_task'
                ? typeof (item as { taskId?: unknown }).taskId === 'string'
                : (item as { kind?: unknown }).kind === 'complete_subtask'
                    && typeof (item as { taskId?: unknown }).taskId === 'string'
                    && typeof (item as { subtaskId?: unknown }).subtaskId === 'string')
        ));
    } catch {
        return [];
    }
}

async function persist(): Promise<void> {
    if (!activeUserId) return;
    await AsyncStorage.setItem(pendingRewardOperationsKey(activeUserId), JSON.stringify([...operations.values()]));
}

/** ログイン/復元で呼ぶ。端末に残った操作を既存メモリとマージして復元する。 */
export async function restorePendingRewardOperations(userId: string): Promise<void> {
    if (activeUserId && activeUserId !== userId) operations.clear();
    activeUserId = userId;
    const stored = deserialize(await AsyncStorage.getItem(pendingRewardOperationsKey(userId)));
    for (const operation of stored) operations.set(operationKey(operation), operation);
    // userId判明前にメモリへ保留された操作もここで同じnamespaceへ永続化する。
    await persist();
}

function defer(operation: PendingRewardOperation): void {
    operations.set(operationKey(operation), operation);
    // 保存失敗時もMapには残るため、同一セッション内の再送機会を失わない。
    void persist().catch(() => undefined);
}

export function deferTaskCompletion(taskId: string): void {
    defer({ kind: 'complete_task', taskId });
}

export function deferSubtaskCompletion(taskId: string, subtaskId: string): void {
    defer({ kind: 'complete_subtask', taskId, subtaskId });
}

/** 削除前に全消去せず、outboxが受理した操作だけを個別に削除する。 */
export async function removePendingRewardOperation(operation: PendingRewardOperation): Promise<void> {
    const key = operationKey(operation);
    const current = operations.get(key);
    if (!current) return;
    operations.delete(key);
    try {
        await persist();
    } catch (error) {
        operations.set(key, current);
        throw error;
    }
}

export function getPendingRewardOperations(): PendingRewardOperation[] {
    return [...operations.values()];
}

/**
 * ログアウト/別アカウント移行時に現在のメモリキューだけを切り離す。
 * user namespaceの保存データは削除しないため、同じユーザーの再ログイン時に復元できる。
 */
export function detachPendingRewardOperations(options: { suppressAnonymousRecovery?: boolean } = {}): void {
    if (options.suppressAnonymousRecovery) suppressNextAnonymousRecovery = true;
    operations.clear();
    activeUserId = null;
}

/** ログアウト起因のanonymous遷移では、直前ユーザーの履歴をローカル報酬にしない。 */
export function consumeAnonymousRecoverySuppression(): boolean {
    const suppress = suppressNextAnonymousRecovery;
    suppressNextAnonymousRecovery = false;
    return suppress;
}

/** テスト用。永続ストレージは呼び出し元が必要に応じて消去する。 */
export function clearPendingRewardOperations(): void {
    detachPendingRewardOperations();
    suppressNextAnonymousRecovery = false;
}
