import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { useMobileTitleStore } from './useMobileTitleStore';
import { enqueueCloudOperation } from '../platform/cloudOutbox';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: vi.fn(async () => true) }));

const storage = vi.mocked(AsyncStorage);
const originalAction = useMobileTitleStore.getState().setActiveTitle;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const envelope = (state: unknown) => JSON.stringify({ state, version: 1 });
async function restore(state: unknown) {
    storage.getItem.mockResolvedValueOnce(envelope(state));
    await useMobileTitleStore.persist.rehydrate();
}
function expectActionSafe() {
    expect(useMobileTitleStore.getState().setActiveTitle).toBe(originalAction);
    expect(Object.keys(useMobileTitleStore.getState()).sort()).toEqual(['activeTitle', 'setActiveTitle']);
}
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a');
    storage.getItem.mockReset().mockResolvedValue(null);
    useMobileTitleStore.setState({ activeTitle: '現在の称号', setActiveTitle: originalAction }, true);
    await useMobileTitleStore.persist.rehydrate();
    vi.clearAllMocks();
});
afterEach(() => { resetAuthLifecycleHooks(); vi.restoreAllMocks(); });

describe('Mobile称号：実persistの保存値と読込競合', () => {
    it.each([
        { name: '文字列', value: '  駆け出し冒険者  ', expected: '駆け出し冒険者' },
        { name: '解除', value: null, expected: null },
        { name: '空白', value: '   ', expected: null },
        { name: '長い文字列', value: 'あ'.repeat(80), expected: 'あ'.repeat(40) },
        { name: 'オブジェクト', value: { bad: 'child' }, expected: null },
        { name: '配列', value: ['bad'], expected: null },
        { name: '数値', value: 123, expected: null },
        { name: '真偽値', value: true, expected: null },
    ])('$nameの保存値を正規化し、操作を保存データで置換しない', async ({ value, expected }) => {
        await restore({ activeTitle: value, setActiveTitle: 'saved-action', unexpected: 'saved-extra' });
        expect(useMobileTitleStore.getState().activeTitle).toBe(expected); expectActionSafe();
        expect(enqueueCloudOperation).not.toHaveBeenCalled();
    });
    it.each([null, 42, 'invalid-root', [], { unrelated: true }])('称号のない保存root %j は現在値と操作を維持する', async (root) => {
        await restore(root);
        expect(useMobileTitleStore.getState().activeTitle).toBe('現在の称号'); expectActionSafe();
    });
    it('JSON破損・読込拒否でも現在の称号と操作を壊さず、次の正常読込で復帰する', async () => {
        storage.getItem.mockResolvedValueOnce('{broken'); await useMobileTitleStore.persist.rehydrate();
        expect(useMobileTitleStore.getState().activeTitle).toBe('現在の称号'); expectActionSafe();
        storage.getItem.mockRejectedValueOnce(new Error('storage unavailable')); await useMobileTitleStore.persist.rehydrate();
        expect(useMobileTitleStore.getState().activeTitle).toBe('現在の称号'); expectActionSafe();
        await restore({ activeTitle: '復帰した称号' });
        expect(useMobileTitleStore.getState().activeTitle).toBe('復帰した称号'); expect(useMobileTitleStore.persist.hasHydrated()).toBe(true);
    });
    it.each(['b', 'logout', 'a-after-logout'])('Aの読込待ち中に%sへ変わった後、旧保存を適用しない', async (next) => {
        const read = deferred<string | null>(); storage.getItem.mockReturnValueOnce(read.promise);
        const pending = useMobileTitleStore.persist.rehydrate();
        if (next === 'b') await notifyLogin('b'); else { await notifyLogout(); if (next === 'a-after-logout') await notifyLogin('a'); }
        useMobileTitleStore.setState({ activeTitle: next === 'b' ? 'Bの称号' : null });
        read.resolve(envelope({ activeTitle: 'Aの古い称号' })); await pending;
        expect(useMobileTitleStore.getState().activeTitle).toBe(next === 'b' ? 'Bの称号' : null); expectActionSafe();
        expect(enqueueCloudOperation).not.toHaveBeenCalled();
    });
    it('同じ本人の重複通知では正常な保存復元を拒否しない', async () => {
        const read = deferred<string | null>(); storage.getItem.mockReturnValueOnce(read.promise);
        const pending = useMobileTitleStore.persist.rehydrate(); await notifyLogin('a');
        read.resolve(envelope({ activeTitle: '本人の称号' })); await pending;
        expect(useMobileTitleStore.getState().activeTitle).toBe('本人の称号'); expectActionSafe();
    });
    it.each(['変更', '同値の明示解除', '変更して元の値へ戻す'])('読込開始後の%sを古い保存で上書きしない', async (kind) => {
        if (kind === '同値の明示解除') useMobileTitleStore.setState({ activeTitle: null });
        const read = deferred<string | null>(); storage.getItem.mockReturnValueOnce(read.promise);
        const pending = useMobileTitleStore.persist.rehydrate();
        if (kind === '変更して元の値へ戻す') { originalAction('一時的な称号'); originalAction('現在の称号'); }
        else originalAction(kind === '同値の明示解除' ? null : '新しい称号');
        const chosen = useMobileTitleStore.getState().activeTitle;
        const sends = vi.mocked(enqueueCloudOperation).mock.calls.length;
        read.resolve(envelope({ activeTitle: '遅い保存の称号' })); await pending;
        expect(useMobileTitleStore.getState().activeTitle).toBe(chosen); expectActionSafe();
        expect(enqueueCloudOperation).toHaveBeenCalledTimes(sends);
    });
    it('通常の設定/保存/再読込でもversion 1と称号フィールドだけを維持する', async () => {
        originalAction('新しい称号');
        const raw = storage.setItem.mock.calls.filter(([key]) => key === 'quest-board-title').at(-1)![1];
        expect(JSON.parse(raw)).toEqual({ state: { activeTitle: '新しい称号' }, version: 1 });
        useMobileTitleStore.setState({ activeTitle: null });
        storage.getItem.mockResolvedValueOnce(raw); await useMobileTitleStore.persist.rehydrate();
        expect(useMobileTitleStore.getState().activeTitle).toBe('新しい称号'); expectActionSafe();
    });
    it('重なった復元では後から始めた読込を維持し、古い完了で戻さない', async () => {
        const oldRead = deferred<string | null>(); const newRead = deferred<string | null>();
        storage.getItem.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
        const old = useMobileTitleStore.persist.rehydrate(); const latest = useMobileTitleStore.persist.rehydrate();
        newRead.resolve(envelope({ activeTitle: '新しい読込の称号' })); await latest;
        oldRead.resolve(envelope({ activeTitle: '古い読込の称号' })); await old;
        expect(useMobileTitleStore.getState().activeTitle).toBe('新しい読込の称号'); expectActionSafe();
        expect(useMobileTitleStore.persist.hasHydrated()).toBe(true); expect(enqueueCloudOperation).not.toHaveBeenCalled();
    });
});
