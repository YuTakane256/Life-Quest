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

    it('別アカウントへ移った後に終わった読み込みを共有キューへマージしない', async () => {
        const storedA = [{ kind: 'complete_task', taskId: 'task-a' }];
        const storedB = [{ kind: 'complete_task', taskId: 'task-b' }];
        let resolveA!: (value: string) => void;
        storage.getItem.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
        const restoringA = restorePendingRewardOperations('user-a');
        detachPendingRewardOperations();
        memory.set(pendingRewardOperationsKey('user-b'), JSON.stringify(storedB));
        await restorePendingRewardOperations('user-b');

        resolveA(JSON.stringify(storedA));
        await restoringA;
        expect(getPendingRewardOperations()).toEqual(storedB);
        expect(JSON.parse(memory.get(pendingRewardOperationsKey('user-b'))!)).toEqual(storedB);
    });

    it('同じ所有者でも無効化された認証世代の読み込みを適用しない', async () => {
        let resolveOld!: (value: string) => void;
        let current = true;
        storage.getItem.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
        const restoring = restorePendingRewardOperations('user-a', () => current);
        current = false;

        resolveOld(JSON.stringify([{ kind: 'complete_task', taskId: 'old-task' }]));
        await restoring;
        expect(getPendingRewardOperations()).toEqual([]);
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('別アカウントへの切替後に失敗した削除を元の操作で巻き戻さない', async () => {
        await restorePendingRewardOperations('user-a');
        deferTaskCompletion('task-a');
        let rejectRemoval!: (error: Error) => void;
        storage.setItem.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRemoval = reject; }));
        const removing = removePendingRewardOperation({ kind: 'complete_task', taskId: 'task-a' });
        const rejection = expect(removing).rejects.toThrow('disk full');
        detachPendingRewardOperations();
        await restorePendingRewardOperations('user-b');
        deferTaskCompletion('task-b');

        rejectRemoval(new Error('disk full'));
        await rejection;
        expect(getPendingRewardOperations()).toEqual([{ kind: 'complete_task', taskId: 'task-b' }]);
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
