import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearPendingWebRewardOperations,
    detachPendingWebRewardOperations,
    deferWebRewardOperation,
    getPendingWebRewardOperations,
    pendingWebRewardOperationsKey,
    removePendingWebRewardOperation,
    restorePendingWebRewardOperations,
} from './pendingRewardOperations';

const operation = { key: 'task-1', priority: 'medium' as const, completedAt: '2026-07-29T00:00:00.000Z', xpReward: 20 };

describe('Web pending reward operations', () => {
    beforeEach(() => {
        localStorage.clear();
        clearPendingWebRewardOperations();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        clearPendingWebRewardOperations();
    });

    it('user namespaceへ保存し、メモリを失った再起動後も復元する', () => {
        restorePendingWebRewardOperations('user-a');
        deferWebRewardOperation(operation);
        expect(localStorage.getItem(pendingWebRewardOperationsKey('user-a'))).toContain('task-1');

        clearPendingWebRewardOperations();
        restorePendingWebRewardOperations('user-a');
        expect(getPendingWebRewardOperations()).toEqual([operation]);
    });

    it('削除の永続化に失敗した場合も操作を保持する', () => {
        restorePendingWebRewardOperations('user-a');
        deferWebRewardOperation(operation);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });

        expect(() => removePendingWebRewardOperation(operation.key)).toThrow('quota');
        expect(getPendingWebRewardOperations()).toEqual([operation]);
    });

    it('ログアウト時はメモリを切り離すが、同じuserだけが保存済み操作を再ログインで復元する', () => {
        restorePendingWebRewardOperations('user-a');
        deferWebRewardOperation(operation);

        detachPendingWebRewardOperations();
        expect(getPendingWebRewardOperations()).toEqual([]);
        expect(localStorage.getItem(pendingWebRewardOperationsKey('user-a'))).toContain('task-1');

        restorePendingWebRewardOperations('user-b');
        expect(getPendingWebRewardOperations()).toEqual([]);

        detachPendingWebRewardOperations();
        restorePendingWebRewardOperations('user-a');
        expect(getPendingWebRewardOperations()).toEqual([operation]);
    });
});
