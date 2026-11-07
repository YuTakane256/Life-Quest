import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, notifyTokenRefreshed, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { clearMobileCloudStores, markCloudSessionSeeded, registerMobileAuthStoreHooks, resetCloudSessionSeeded } from '../platform/authStores';
import { useMobileStatsStore } from './useMobileStatsStore';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('./useMobileLoginBonusStore', () => ({ beginMobileLoginBonusCloudSession: vi.fn(), clearMobileLoginBonusCloudSession: vi.fn() }));

const storage = vi.mocked(AsyncStorage);
const oldLog = { taskXpLog: { '2026-10-01': 80 }, habitLog: { '2026-10-01': { count: 3, allComplete: true } }, seeded: true };
const emptyLog = { taskXpLog: {}, habitLog: {}, seeded: false };
const nextLog = { taskXpLog: { '2026-11-07': 10 }, habitLog: { '2026-11-07': { count: 1, allComplete: false } }, seeded: false };
const envelope = (state: unknown) => JSON.stringify({ state, version: 1 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function startRead() {
    const read = deferred<string | null>(); storage.getItem.mockReturnValueOnce(read.promise);
    return { read, pending: useMobileStatsStore.persist.rehydrate() };
}
beforeEach(async () => {
    resetAuthLifecycleHooks(); resetCloudSessionSeeded(); await notifyLogin('a');
    storage.getItem.mockReset().mockResolvedValue(null);
    useMobileStatsStore.setState({ ...emptyLog, hasHydrated: false });
    await useMobileStatsStore.persist.rehydrate(); vi.clearAllMocks();
});
afterEach(() => { resetAuthLifecycleHooks(); resetCloudSessionSeeded(); vi.restoreAllMocks(); });

describe('Mobile統計の保存読込と認証境界', () => {
    it.each(['b', 'logout', 'a-after-logout'])('%sへの認証変更だけでも旧世代の統計を取り込まない', async (next) => {
        useMobileStatsStore.setState({ ...nextLog, hasHydrated: false });
        const { read, pending } = startRead();
        if (next === 'b') await notifyLogin('b'); else { await notifyLogout(); if (next === 'a-after-logout') await notifyLogin('a'); }
        read.resolve(envelope(oldLog)); await pending;
        expect(useMobileStatsStore.getState()).toMatchObject({ ...nextLog, hasHydrated: true });
        expect(useMobileStatsStore.persist.hasHydrated()).toBe(true);
    });
    it.each(['switch', 'logout'])('実認証フックの%sで片付けた旧統計を、遅い保存読込で戻さない', async (transition) => {
        registerMobileAuthStoreHooks(); await notifyLogin('a'); markCloudSessionSeeded();
        useMobileStatsStore.setState({ ...oldLog, hasHydrated: false });
        const { read, pending } = startRead();
        if (transition === 'switch') await notifyLogin('b'); else await notifyLogout();
        expect(useMobileStatsStore.getState()).toMatchObject(emptyLog);
        read.resolve(envelope(oldLog)); await pending;
        expect(useMobileStatsStore.getState()).toMatchObject({ ...emptyLog, hasHydrated: true });
        // Rejected restoration still leaves the real actions usable.
        useMobileStatsStore.getState().logTaskXp('2026-11-07', 5);
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-11-07': 5 });
    });
    it('Bの新しいクラウド統計と習慣ログをAの遅い読込で上書きしない', async () => {
        registerMobileAuthStoreHooks(); await notifyLogin('a'); markCloudSessionSeeded();
        const { read, pending } = startRead(); await notifyLogin('b');
        useMobileStatsStore.getState().mergeFromCloud(nextLog);
        read.resolve(envelope(oldLog)); await pending;
        expect(useMobileStatsStore.getState()).toMatchObject(nextLog);
        expect(useMobileStatsStore.getState().taskXpLog['2026-10-01']).toBeUndefined();
    });
    it.each(['unchanged', 'duplicate-login', 'token-refresh'])('同じ本人の%sでは保存済み履歴と初回seed済みを復元する', async (kind) => {
        const { read, pending } = startRead();
        if (kind === 'duplicate-login') await notifyLogin('a');
        if (kind === 'token-refresh') await notifyTokenRefreshed('a');
        read.resolve(envelope(oldLog)); await pending;
        expect(useMobileStatsStore.getState()).toMatchObject({ ...oldLog, hasHydrated: true });
        useMobileStatsStore.getState().seedIfNeeded([], [], []);
        expect(useMobileStatsStore.getState()).toMatchObject(oldLog);
    });
    it('匿名の通常復元は維持し、匿名からログインを跨いだ古い読込だけを拒否する', async () => {
        await notifyLogout(); const first = startRead(); first.read.resolve(envelope(oldLog)); await first.pending;
        expect(useMobileStatsStore.getState()).toMatchObject(oldLog);
        const second = startRead(); await notifyLogin('b'); clearMobileCloudStores();
        second.read.resolve(envelope(oldLog)); await second.pending;
        expect(useMobileStatsStore.getState()).toMatchObject(emptyLog);
    });
    it('世代を跨いだ読込を拒否した後、Bの新しい読込は正常に復元・保存できる', async () => {
        const old = startRead(); await notifyLogin('b'); old.read.resolve(envelope(oldLog)); await old.pending;
        storage.getItem.mockResolvedValueOnce(envelope(nextLog)); await useMobileStatsStore.persist.rehydrate();
        expect(useMobileStatsStore.getState()).toMatchObject(nextLog);
        useMobileStatsStore.getState().logTaskXp('2026-11-07', 5);
        const raw = storage.setItem.mock.calls.filter(([key]) => key === 'quest-board-mobile-stats').at(-1)![1];
        expect(JSON.parse(raw)).toEqual({ state: { ...nextLog, taskXpLog: { '2026-11-07': 15 } }, version: 1 });
    });
    it('重複読込は新世代の最新読込を採用し、旧完了で戻さない', async () => {
        const old = startRead(); await notifyLogin('b'); const latest = startRead();
        latest.read.resolve(envelope(nextLog)); await latest.pending;
        old.read.resolve(envelope(oldLog)); await old.pending;
        expect(useMobileStatsStore.getState()).toMatchObject(nextLog);
        expect(useMobileStatsStore.persist.hasHydrated()).toBe(true);
    });
});
