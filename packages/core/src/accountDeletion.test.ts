import { describe, expect, it } from 'vitest';
import { accountDeletionKeys, deleteAccountCloudData, runAccountDeletionCleanup } from './accountDeletion.ts';

function createStorage(failKey?: string) {
    const removed: string[] = [];
    return {
        removed,
        storage: {
            getItem: async () => null,
            setItem: async () => undefined,
            removeItem: async (key: string) => {
                removed.push(key);
                if (key === failKey) throw new Error('remove failed');
            },
        },
    };
}

describe('account deletion local cleanup', () => {
    it('指定ユーザーのクラウド名前空間だけを削除対象にする', () => {
        const keys = accountDeletionKeys('user-a');
        expect(keys.length).toBe(8);
        expect(keys).toContain('life-quest:cloud:user-a:pending-reward-operations:v1');
        expect(keys.every((key) => key.includes('life-quest:cloud:user-a:'))).toBe(true);
        expect(keys.some((key) => key.includes('user-b'))).toBe(false);
        expect(keys.some((key) => key.startsWith('quest-board-'))).toBe(false);
    });

    it('個別の削除が失敗しても残りの名前空間を削除しようとする', async () => {
        const keys = accountDeletionKeys('user-a');
        const { storage, removed } = createStorage(keys[2]);
        await expect(deleteAccountCloudData(storage, 'user-a')).rejects.toThrow('remove failed');
        expect(removed).toEqual(keys);
    });

    it('停止→名前空間削除→メモリ初期化の順で実行する', async () => {
        const order: string[] = [];
        await runAccountDeletionCleanup({
            stopSync: () => { order.push('sync'); },
            stopOutbox: () => { order.push('outbox'); },
            removeCloudData: async () => { order.push('keys'); },
            resetMemory: () => { order.push('memory'); },
        });
        expect(order).toEqual(['sync', 'outbox', 'keys', 'memory']);
    });

    it('途中で失敗しても残りのcleanup工程をすべて試みる', async () => {
        const order: string[] = [];
        await expect(runAccountDeletionCleanup({
            stopSync: () => { order.push('sync'); throw new Error('sync'); },
            stopOutbox: () => { order.push('outbox'); },
            removeCloudData: async () => { order.push('keys'); throw new Error('keys'); },
            resetMemory: () => { order.push('memory'); },
        })).rejects.toThrow('account deletion cleanup incomplete');
        expect(order).toEqual(['sync', 'outbox', 'keys', 'memory']);
    });
});
