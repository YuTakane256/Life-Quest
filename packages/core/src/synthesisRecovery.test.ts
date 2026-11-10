import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAuthSessionScope, notifyLogin, notifyLogout, resetAuthLifecycleHooks } from './authLifecycle.ts';
import { createSynthesisRecovery, synthesisRecoveryKey } from './synthesisRecovery.ts';

const ids = ['material-3', 'material-1', 'material-2'];
const ownerKey = synthesisRecoveryKey('a');
function diskAdapter(disk = new Map<string, string>()) {
    return {
        disk,
        storage: {
            getItem: vi.fn((key: string): string | null | Promise<string | null> => disk.get(key) ?? null),
            setItem: vi.fn((key: string, value: string): void | Promise<void> => { disk.set(key, value); }),
            removeItem: vi.fn((key: string): void | Promise<void> => { disk.delete(key); }),
        },
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

beforeEach(async () => { resetAuthLifecycleHooks(); await notifyLogin('a'); });
afterEach(() => resetAuthLifecycleHooks());

describe('本人の合成を再起動後も復元する', () => {
    it('別のインスタンスで保存した素材順とキーを再利用し、確認後にだけ消す', async () => {
        const { storage, disk } = diskAdapter();
        const first = createSynthesisRecovery({ storage });
        const { record } = await first.prepare('a', ids, () => 'stable');
        const reopened = createSynthesisRecovery({ storage });
        await reopened.load();
        expect(reopened.getState().pending).toEqual(record);
        const resume = await reopened.prepare('a', [...ids].reverse(), () => 'unused', record);
        expect(resume).toEqual({ record: { version: 1, userId: 'a', key: 'stable', itemIds: ids }, fresh: false });
        expect(storage.setItem).toHaveBeenCalledTimes(1);
        expect(await reopened.acknowledge(record, captureAuthSessionScope())).toBe(true);
        expect(disk.has(ownerKey)).toBe(false);
    });

    it('保存に失敗すると送信に使える記録を返さない', async () => {
        const { storage, disk } = diskAdapter();
        const recovery = createSynthesisRecovery({ storage });
        storage.setItem.mockRejectedValueOnce(new Error('disk full'));
        await expect(recovery.prepare('a', ids, () => 'stable')).rejects.toThrow('disk full');
        expect(disk.size).toBe(0);
        expect(recovery.getState().pending).toBeNull();
    });

    it('別素材の同時準備は先に保存した内容を上書きしない', async () => {
        const { storage, disk } = diskAdapter();
        let tail: Promise<unknown> = Promise.resolve();
        const withLock = <T,>(_owner: string, work: () => Promise<T>) => {
            const result = tail.catch(() => {}).then(work);
            tail = result;
            return result;
        };
        const first = createSynthesisRecovery({ storage, withLock });
        const other = createSynthesisRecovery({ storage, withLock });
        const results = await Promise.allSettled([
            first.prepare('a', ids, () => 'first'),
            other.prepare('a', ['other-1', 'other-2', 'other-3'], () => 'second'),
        ]);
        expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'rejected']);
        expect(JSON.parse(disk.get(ownerKey)!).key).toBe('first');
        expect(other.getState().pending?.key).toBe('first');
    });

    it('Bへの切替後はAの遅い読込を表示せず、Aの保留を再送しない', async () => {
        const { storage } = diskAdapter();
        const recovery = createSynthesisRecovery({ storage });
        const { record } = await recovery.prepare('a', ids, () => 'stable');
        const delayed = deferred<string | null>();
        storage.getItem.mockReturnValueOnce(delayed.promise);
        const oldLoad = recovery.load();
        await vi.waitFor(() => expect(storage.getItem).toHaveBeenCalledTimes(2));
        await notifyLogin('b');
        await recovery.load();
        delayed.resolve(JSON.stringify(record));
        await oldLoad;
        expect(recovery.getState()).toEqual({ userId: 'b', pending: null, status: 'ready' });
        await expect(recovery.prepare('b', ids, () => 'new', record)).rejects.toThrow();
        expect(storage.setItem).toHaveBeenCalledTimes(1);
    });

    it('古い確認応答と解除操作は、新しく保存された別の合成を消さない', async () => {
        const { storage, disk } = diskAdapter();
        const recovery = createSynthesisRecovery({ storage });
        const { record } = await recovery.prepare('a', ids, () => 'first');
        const old = recovery.getState();
        disk.set(ownerKey, JSON.stringify({ ...record, key: 'newer' }));
        expect(await recovery.discard(old, captureAuthSessionScope())).toBe(false);
        expect(await recovery.acknowledge(record, captureAuthSessionScope())).toBe(false);
        expect(JSON.parse(disk.get(ownerKey)!).key).toBe('newer');
    });

    it('壊れた保存を上書きせず、所有者を切り替えた古い解除も無効にする', async () => {
        const { storage, disk } = diskAdapter(new Map([[ownerKey, 'broken']]));
        const recovery = createSynthesisRecovery({ storage });
        const stop = recovery.register();
        try {
            await recovery.load();
            expect(recovery.getState().status).toBe('unreadable');
            await expect(recovery.prepare('a', ids, () => 'stable')).rejects.toThrow();
            const beforeLogout = recovery.getState();
            await notifyLogout();
            await notifyLogin('a');
            await recovery.load();
            expect(await recovery.discard(beforeLogout, captureAuthSessionScope())).toBe(false);
            expect(disk.get(ownerKey)).toBe('broken');
            expect(await recovery.discard(recovery.getState(), captureAuthSessionScope())).toBe(true);
            expect(disk.has(ownerKey)).toBe(false);
        } finally { stop(); }
    });

    it('退会時は端末の書き込み完了を待ち、以後の書き込みを受け付けない', async () => {
        const { storage, disk } = diskAdapter();
        const recovery = createSynthesisRecovery({ storage });
        const delayed = deferred<void>();
        storage.setItem.mockImplementationOnce(async (key, value) => { await delayed.promise; disk.set(key, value); });
        const write = expect(recovery.prepare('a', ids, () => 'stable')).rejects.toThrow();
        await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(1));
        const retire = recovery.retire('a').then(() => storage.removeItem(ownerKey));
        delayed.resolve();
        await write;
        await retire;
        await expect(recovery.prepare('a', ids, () => 'new')).rejects.toThrow();
        expect(disk.has(ownerKey)).toBe(false);
    });
});
