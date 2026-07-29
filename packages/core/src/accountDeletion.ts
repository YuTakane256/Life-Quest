/**
 * 退会成功後にだけ削除する、認証ユーザー固有の端末データ。
 * 匿名利用の quest-board-* キーには触れない。
 */
import { cloudCacheKey, type CloudCacheSection } from './cloudCache.ts';
import { preMigrationBackupKey } from './cloudImport.ts';
import { cloudCursorKey, cloudOutboxKey } from './cloudPull.ts';
import type { RepositoryStorage } from './syncRepository.ts';

/** 追加の認証ユーザー固有キュー。#613由来の保留報酬操作も退会時に破棄する。 */
export const ACCOUNT_DELETION_EXTRA_KEYS: readonly ((userId: string) => string)[] = [
    (userId) => `life-quest:cloud:${userId}:pending-reward-operations:v1`,
];

export function accountDeletionKeys(userId: string): string[] {
    return [
        ...(['tasks', 'habits', 'game', 'profile'] as const satisfies readonly CloudCacheSection[])
            .map((section) => cloudCacheKey(userId, section)),
        cloudCursorKey(userId),
        cloudOutboxKey(userId),
        preMigrationBackupKey(userId),
        ...ACCOUNT_DELETION_EXTRA_KEYS.map((key) => key(userId)),
    ];
}

/** 個々の削除失敗で中断せず、全キーの削除を試みる。 */
export async function deleteAccountCloudData(storage: RepositoryStorage, userId: string): Promise<void> {
    const results = await Promise.allSettled(accountDeletionKeys(userId).map((key) => storage.removeItem(key)));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
}

export interface AccountDeletionCleanupDeps {
    stopSync: () => void | Promise<void>;
    stopOutbox: () => void | Promise<void>;
    removeCloudData: () => Promise<void>;
    resetMemory: () => void | Promise<void>;
}

/** 退会後処理の順序を固定する。サーバー成功前には呼び出してはならない。 */
export async function runAccountDeletionCleanup(deps: AccountDeletionCleanupDeps): Promise<void> {
    const failures: unknown[] = [];
    for (const step of [deps.stopSync, deps.stopOutbox, deps.removeCloudData, deps.resetMemory]) {
        try {
            await step();
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0) {
        const error = new Error('account deletion cleanup incomplete') as Error & { errors?: unknown[] };
        error.errors = failures;
        throw error;
    }
}
