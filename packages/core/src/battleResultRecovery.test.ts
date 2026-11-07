import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAuthSessionScope, notifyLogin, notifyLogout, resetAuthLifecycleHooks } from './authLifecycle.ts';
import { createBattleResultRecovery, battleResultRecoveryKey, decodeSavedBattleResult, type SavedBattleResult } from './battleResultRecovery.ts';
import { applyPullBatchToCache, createEmptyCloudCache } from './cloudCache.ts';
import type { ResolveBattleAttemptResponse } from './gameCloud.ts';

const packet = { attemptId: 'attempt-a', key: 'key-a', actions: [{ type: 'attack' }, { type: 'skill', skillId: 'power_strike' }] } as const;
const ownerKey = battleResultRecoveryKey('a');
const accepted = { outcome: 'victory', granted: true } as const;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function fixture(disk = new Map<string, string>()) {
    const storage = { getItem: vi.fn((key: string): string | null | Promise<string | null> => disk.get(key) ?? null),
        setItem: vi.fn((key: string, value: string): void | Promise<void> => { disk.set(key, value); }),
        removeItem: vi.fn((key: string): void | Promise<void> => { disk.delete(key); }) };
    const send = vi.fn<(record: SavedBattleResult, isActive: () => boolean) => Promise<ResolveBattleAttemptResponse>>(async () => accepted);
    const onResolved = vi.fn(async () => {});
    return { disk, storage, send, onResolved, controller: createBattleResultRecovery({ storage, send, onResolved }) };
}
const receipt = (overrides: Record<string, unknown> = {}) => applyPullBatchToCache(createEmptyCloudCache(), {
    next_cursor: 7, has_more: false,
    battle_attempts: [{ id: packet.attemptId, user_id: 'a', status: 'resolved', outcome: 'victory', version: 7, ...overrides }],
});
beforeEach(async () => { resetAuthLifecycleHooks(); await notifyLogin('a'); });
afterEach(() => { resetAuthLifecycleHooks(); vi.restoreAllMocks(); });

describe('所有者付きの戦闘結果保存と再送', () => {
    it('保存完了を待ち、別キーでの同一attempt準備にも元の行動列を使う', async () => {
        const f = fixture(); const write = deferred<void>();
        f.storage.setItem.mockImplementationOnce(async (key, value) => { await write.promise; f.disk.set(key, value); });
        const pending = f.controller.prepare('a', packet);
        await vi.waitFor(() => expect(f.storage.setItem).toHaveBeenCalledTimes(1));
        expect(f.controller.getState().pending).toBeNull(); expect(f.send).not.toHaveBeenCalled();
        write.resolve(); const saved = await pending;
        const next = await f.controller.prepare('a', { ...packet, key: 'new-key', actions: [{ type: 'attack' }] });
        expect(next).toEqual(saved); expect(saved).toEqual({ ...packet, version: 1, userId: 'a' });
        expect(JSON.parse(f.disk.get(ownerKey)!)).toEqual(saved);
    });
    it('新しいインスタンスで保存を読み、明示操作1回だけで同じ内容を送り同期へ進む', async () => {
        const first = fixture(); const saved = await first.controller.prepare('a', packet);
        const next = fixture(first.disk); await next.controller.load();
        expect(next.send).not.toHaveBeenCalled(); expect(next.controller.isBlocking()).toBe(true);
        const requested = next.controller.getState().pending!;
        expect(requested).toEqual(saved);
        await Promise.all([next.controller.retry(requested), next.controller.retry(requested)]);
        expect(next.send).toHaveBeenCalledTimes(1); expect(next.send.mock.calls[0][0]).toEqual(saved);
        expect(next.onResolved).toHaveBeenCalledTimes(1); expect(next.disk.has(ownerKey)).toBe(false);
        expect(next.controller.isBlocking()).toBe(false);
    });
    it('保存に失敗した場合、準備の成功や別の結果による上書きを認めない', async () => {
        const f = fixture(); f.storage.setItem.mockRejectedValueOnce(new Error('write failed'));
        await expect(f.controller.prepare('a', packet)).rejects.toThrow();
        expect(f.disk.has(ownerKey)).toBe(false); expect(f.controller.getState().pending).toBeNull();
        const saved = await f.controller.prepare('a', packet);
        await expect(f.controller.prepare('a', { ...packet, attemptId: 'next' })).rejects.toThrow();
        expect(JSON.parse(f.disk.get(ownerKey)!)).toEqual(saved);
    });
    it('Bへの切替はAの古いボタンを無効にし、Aに戻ったら本人の保存を維持する', async () => {
        const f = fixture(); const old = await f.controller.prepare('a', packet);
        await notifyLogin('b'); await f.controller.load(); await f.controller.retry(old);
        expect(f.controller.getState()).toMatchObject({ userId: 'b', pending: null }); expect(f.send).not.toHaveBeenCalled();
        expect(f.disk.has(ownerKey)).toBe(true);
        await notifyLogin('a'); await f.controller.load(); await f.controller.retry(old);
        expect(f.send).not.toHaveBeenCalled(); // Old UI identity, even though the account ID is the same.
        await f.controller.retry(f.controller.getState().pending!); expect(f.send).toHaveBeenCalledTimes(1);
    });
    it('遅いAの読込はBの状態へ載らない', async () => {
        const f = fixture(); const read = deferred<string | null>(); f.storage.getItem.mockReturnValueOnce(read.promise);
        const pending = f.controller.load(); await vi.waitFor(() => expect(f.storage.getItem).toHaveBeenCalledTimes(1));
        await notifyLogin('b'); await f.controller.load();
        read.resolve(JSON.stringify({ ...packet, version: 1, userId: 'a' })); await pending;
        expect(f.controller.getState()).toMatchObject({ userId: 'b', phase: 'ready', pending: null });
    });
    it('遅いAの保存完了はBへ公開せず、Aのディスクにだけ残す', async () => {
        const f = fixture(); const write = deferred<void>();
        f.storage.setItem.mockImplementationOnce(async (key, value) => { await write.promise; f.disk.set(key, value); });
        const saved = f.controller.prepare('a', packet); const rejected = expect(saved).rejects.toThrow();
        await vi.waitFor(() => expect(f.storage.setItem).toHaveBeenCalledTimes(1));
        await notifyLogin('b'); await f.controller.load(); write.resolve(); await rejected;
        expect(f.controller.getState()).toMatchObject({ userId: 'b', pending: null }); expect(f.disk.has(ownerKey)).toBe(true);
    });
    it('A→logout→Aで古い応答を捨て、保存の再送を新しい認証世代で行える', async () => {
        const f = fixture(); const oldResponse = deferred<ResolveBattleAttemptResponse>(); f.send.mockReturnValueOnce(oldResponse.promise);
        const stop = f.controller.register();
        try {
            const saved = await f.controller.prepare('a', packet); const first = f.controller.retry(saved);
            await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
            await notifyLogout(); await notifyLogin('a'); await f.controller.load();
            await f.controller.retry(f.controller.getState().pending!);
            oldResponse.resolve(accepted); await first;
            expect(f.send).toHaveBeenCalledTimes(2); expect(f.send.mock.calls[0][1]()).toBe(false);
            expect(f.onResolved).toHaveBeenCalledTimes(1); expect(f.disk.has(ownerKey)).toBe(false);
        } finally { stop(); }
    });
    it.each(['transport', 'malformed-ack', 'remove'] as const)('%s失敗で保存を消さず、同じキーで再送できる', async (failure) => {
        const f = fixture(); const saved = await f.controller.prepare('a', packet);
        if (failure === 'transport') f.send.mockRejectedValueOnce(new Error('response lost'));
        if (failure === 'malformed-ack') f.send.mockResolvedValueOnce({ outcome: 'victory' } as ResolveBattleAttemptResponse);
        if (failure === 'remove') f.storage.removeItem.mockRejectedValueOnce(new Error('delete failed'));
        await f.controller.retry(saved);
        expect(f.controller.getState().phase).toBe('failed'); expect(f.disk.has(ownerKey)).toBe(true); expect(f.onResolved).not.toHaveBeenCalled();
        await f.controller.retry(f.controller.getState().pending!);
        expect(f.send.mock.calls.map(([record]) => record.key)).toEqual(['key-a', 'key-a']);
        expect(f.disk.has(ownerKey)).toBe(false); expect(f.onResolved).toHaveBeenCalledTimes(1);
    });
    it.each([
        '{broken', JSON.stringify({ ...packet, version: 2, userId: 'a' }), JSON.stringify({ ...packet, version: 1, userId: 'b' }),
        JSON.stringify({ ...packet, version: 1, userId: 'a', actions: [{ type: 'bad' }] }),
        JSON.stringify({ ...packet, version: 1, userId: 'a', actions: Array.from({ length: 1001 }, () => ({ type: 'attack' })) }),
    ])('不正/他所有者の保存は通信も上書きもせずblockedにする', async (raw) => {
        const f = fixture(new Map([[ownerKey, raw]])); await f.controller.load();
        expect(f.controller.getState()).toMatchObject({ phase: 'blocked', pending: null });
        await expect(f.controller.prepare('a', packet)).rejects.toThrow();
        expect(f.disk.get(ownerKey)).toBe(raw); expect(f.send).not.toHaveBeenCalled();
    });
    it.each([{ user_id: 'b' }, { status: 'in_progress' }, { deleted_at: '2026-11-07' }, { outcome: null }])('確定根拠がない受信行では保存を消さない', async (row) => {
        const f = fixture(); await f.controller.prepare('a', packet);
        await f.controller.reconcile(receipt(row), captureAuthSessionScope());
        expect(f.disk.has(ownerKey)).toBe(true);
    });
    it('本人の確定行を受信済みなら、画面が無くても再送せずに消す', async () => {
        const f = fixture(); await f.controller.prepare('a', packet);
        await f.controller.reconcile(receipt(), captureAuthSessionScope());
        expect(f.disk.has(ownerKey)).toBe(false); expect(f.send).not.toHaveBeenCalled();
    });
    it('確定を同期した後の通信失敗では、再送や次の戦闘をブロックしない', async () => {
        const f = fixture();
        let reject!: (error: Error) => void;
        f.send.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
        const saved = await f.controller.prepare('a', packet);
        const retry = f.controller.retry(saved);
        await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
        await f.controller.load();
        expect(f.controller.getState().phase).toBe('sending');
        await f.controller.reconcile(receipt(), captureAuthSessionScope());
        reject(new Error('response lost after sync'));
        await retry;
        expect(f.controller.getState()).toMatchObject({ phase: 'ready', pending: null });
        expect(f.controller.isBlocking()).toBe(false);
    });
    it('別タブの保存を準備時に見つけたら、その結果を提示する', async () => {
        const first = fixture();
        const saved = await first.controller.prepare('a', packet);
        const other = fixture(first.disk);
        await expect(other.controller.prepare('a', { ...packet, attemptId: 'other' })).rejects.toThrow();
        expect(other.controller.getState().pending).toEqual(saved);
    });
    it('破損データを確認した後、別タブが上書きした結果は破棄しない', async () => {
        const f = fixture(new Map([[ownerKey, '{broken']]));
        await f.controller.load();
        const blocked = f.controller.getState();
        expect(f.controller.canDiscard(blocked)).toBe(true);
        const valid = JSON.stringify({ ...packet, version: 1, userId: 'a' });
        f.disk.set(ownerKey, valid);
        await expect(f.controller.discard(blocked)).resolves.toBe(false);
        expect(f.disk.get(ownerKey)).toBe(valid);
        await f.controller.load();
        await expect(f.controller.discard(f.controller.getState())).resolves.toBe(true);
        expect(f.disk.has(ownerKey)).toBe(false);
        expect(f.controller.isBlocking()).toBe(false);
        expect(f.send).not.toHaveBeenCalled();
    });
    it('破棄の確認中に別アカウントへ切り替わっても元の結果を削除しない', async () => {
        const f = fixture();
        await f.controller.prepare('a', packet);
        const snapshot = f.controller.getState();
        await notifyLogin('b');
        await expect(f.controller.discard(snapshot)).resolves.toBe(false);
        expect(f.disk.has(ownerKey)).toBe(true);
    });
    it('古い応答は別attemptの新しい保存を削除できない', async () => {
        const f = fixture(); const old = await f.controller.prepare('a', packet);
        const newer = { ...old, attemptId: 'other', key: 'other-key' }; f.disk.set(ownerKey, JSON.stringify(newer));
        await expect(f.controller.acknowledge(old)).rejects.toThrow();
        expect(decodeSavedBattleResult(f.disk.get(ownerKey)!, 'a')).toEqual(newer);
    });
    it('共有の排他を使う2つのWebインスタンスで、古い保留を上書きしない', async () => {
        const f = fixture(); let tail = Promise.resolve<unknown>(undefined);
        const withLock = <T>(_userId: string, work: () => Promise<T>) => { const next = tail.catch(() => {}).then(work); tail = next; return next; };
        const first = createBattleResultRecovery({ ...f, withLock }); const second = createBattleResultRecovery({ ...f, withLock });
        const results = await Promise.allSettled([first.prepare('a', packet), second.prepare('a', { ...packet, attemptId: 'other' })]);
        expect(results.map((item) => item.status)).toEqual(['fulfilled', 'rejected']);
        expect(decodeSavedBattleResult(f.disk.get(ownerKey)!, 'a').attemptId).toBe(packet.attemptId);
    });
    it('退会時は書込を失効させて完了を待ち、削除後に保存を復活させない', async () => {
        const f = fixture(); const write = deferred<void>(); let retired = false;
        f.storage.setItem.mockImplementationOnce(async (key, value) => { await write.promise; f.disk.set(key, value); });
        const save = f.controller.prepare('a', packet); const rejected = expect(save).rejects.toThrow();
        await vi.waitFor(() => expect(f.storage.setItem).toHaveBeenCalledTimes(1));
        const retire = f.controller.retire('a').then(() => { f.disk.delete(ownerKey); retired = true; });
        await Promise.resolve(); expect(retired).toBe(false);
        write.resolve(); await rejected; await retire;
        await expect(f.controller.prepare('a', packet)).rejects.toThrow(); expect(f.disk.has(ownerKey)).toBe(false);
        expect(f.controller.getState().phase).toBe('inactive');
    });
});
