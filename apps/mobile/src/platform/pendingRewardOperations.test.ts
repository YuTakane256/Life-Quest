import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearPendingRewardOperations,
    detachPendingRewardOperations,
    deferTaskCompletion,
    getPendingRewardOperations,
    pendingRewardOperationsKey,
    removePendingRewardOperation,
    restorePendingRewardOperations,
} from './pendingRewardOperations';

const memory = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => { memory.set(key, value); }),
    },
}));

const storage = vi.mocked(AsyncStorage);

describe('Mobile pending reward operations', () => {
    beforeEach(() => {
        memory.clear();
        vi.clearAllMocks();
        clearPendingRewardOperations();
    });

    afterEach(() => clearPendingRewardOperations());

    it('user namespaceへ保存し、メモリを失った再起動後も復元する', async () => {
        await restorePendingRewardOperations('user-a');
        deferTaskCompletion('task-1');
        await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
        expect(memory.get(pendingRewardOperationsKey('user-a'))).toContain('task-1');

        clearPendingRewardOperations();
        await restorePendingRewardOperations('user-a');
        expect(getPendingRewardOperations()).toEqual([{ kind: 'complete_task', taskId: 'task-1' }]);
    });

    it('削除の永続化に失敗した場合も操作を保持する', async () => {
        await restorePendingRewardOperations('user-a');
        deferTaskCompletion('task-1');
        await vi.waitFor(() => expect(memory.get(pendingRewardOperationsKey('user-a'))).toContain('task-1'));
        storage.setItem.mockRejectedValueOnce(new Error('disk full'));

        await expect(removePendingRewardOperation({ kind: 'complete_task', taskId: 'task-1' })).rejects.toThrow('disk full');
        expect(getPendingRewardOperations()).toEqual([{ kind: 'complete_task', taskId: 'task-1' }]);
    });

    it('ログアウト時はメモリを切り離すが、同じuserだけが保存済み操作を再ログインで復元する', async () => {
        await restorePendingRewardOperations('user-a');
        deferTaskCompletion('task-1');
        await vi.waitFor(() => expect(memory.get(pendingRewardOperationsKey('user-a'))).toContain('task-1'));

        detachPendingRewardOperations();
        expect(getPendingRewardOperations()).toEqual([]);
        expect(memory.get(pendingRewardOperationsKey('user-a'))).toContain('task-1');

        await restorePendingRewardOperations('user-b');
        expect(getPendingRewardOperations()).toEqual([]);

        detachPendingRewardOperations();
        await restorePendingRewardOperations('user-a');
        expect(getPendingRewardOperations()).toEqual([{ kind: 'complete_task', taskId: 'task-1' }]);
    });
});
