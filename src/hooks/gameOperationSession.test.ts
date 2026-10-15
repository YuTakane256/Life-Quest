import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), chest: vi.fn(), synth: vi.fn(),
    applyChest: vi.fn(), discard: vi.fn(), localChest: vi.fn(), applySynth: vi.fn(), localSynth: vi.fn(),
    state: { chestQueue: [{ id: 'chest', opened: false, origin: 'local' }], equipment: [] },
}));
vi.mock('../platform/auth', () => ({ getGameAuthState: mocks.auth }));
vi.mock('../../apps/mobile/src/platform/auth', () => ({ getGameAuthState: mocks.auth }));
vi.mock('../platform/gameCloud', () => ({ openCloudChest: mocks.chest, synthesizeCloudItems: mocks.synth }));
vi.mock('../../apps/mobile/src/platform/battleCloud', () => ({ openCloudChest: mocks.chest, synthesizeCloudItems: mocks.synth }));
vi.mock('../stores/useGameStore', () => {
    const getState = () => ({ ...mocks.state, applyCloudChestResult: mocks.applyChest, discardSyncedChest: mocks.discard,
        openChest: mocks.localChest, applyCloudSynthesisResult: mocks.applySynth, synthesizeItems: mocks.localSynth });
    return { useGameStore: Object.assign((select: (state: ReturnType<typeof getState>) => unknown) => select(getState()), { getState }) };
});
vi.mock('../../apps/mobile/src/stores/useMobileGameStore', () => {
    const getState = () => ({ ...mocks.state, applyCloudChestResult: mocks.applyChest, discardSyncedChest: mocks.discard,
        openChest: mocks.localChest, applyCloudSynthesisResult: mocks.applySynth, synthesizeItems: mocks.localSynth });
    return { useMobileGameStore: Object.assign((select: (state: ReturnType<typeof getState>) => unknown) => select(getState()), { getState }) };
});
import { useCloudChestOpen as webChest } from './useCloudChestOpen';
import { useCloudItemSynthesis as webSynthesis } from './useCloudItemSynthesis';
import { useCloudChestOpen as mobileChest } from '../../apps/mobile/src/hooks/useCloudChestOpen';
import { useCloudItemSynthesis as mobileSynthesis } from '../../apps/mobile/src/hooks/useCloudItemSynthesis';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
let root: Root;
let container: HTMLDivElement;
let mounted: boolean;
beforeEach(async () => {
    resetAuthLifecycleHooks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    for (const value of Object.values(mocks)) if (typeof value === 'function') vi.mocked(value).mockReset();
    mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'a' });
    mocks.chest.mockResolvedValue({ itemId: 'item', templateId: 'wooden_sword', starterCharacter: false });
    mocks.synth.mockResolvedValue({ resultId: 'item', templateId: 'wooden_sword' });
    mocks.applyChest.mockReturnValue(null); mocks.localChest.mockReturnValue(null);
    mocks.applySynth.mockReturnValue(null); mocks.localSynth.mockReturnValue(null);
    mocks.state.chestQueue = [{ id: 'chest', opened: false, origin: 'local' }];
    await notifyLogin('a');
    container = document.createElement('div'); document.body.append(container); root = createRoot(container); mounted = true;
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); container.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals(); });

describe.each([
    { name: 'Web', useChest: webChest, useSynthesis: webSynthesis },
    { name: 'Mobile', useChest: mobileChest, useSynthesis: mobileSynthesis },
])('$nameの宝箱・合成フック', ({ useChest, useSynthesis }) => {
    let chest: ReturnType<typeof useChest>;
    let synth: ReturnType<typeof useSynthesis>;
    async function mount() {
        function Harness() { chest = useChest(); synth = useSynthesis(); return null; }
        await act(async () => root.render(createElement(Harness)));
    }
    it('同一tickで連打しても送信・適用は一度だけ', async () => {
        await mount();
        await act(async () => {
            await Promise.all([chest.openChest('chest'), chest.openChest('chest'),
                synth.synthesize(['one', 'two', 'three']), synth.synthesize(['one', 'two', 'three'])]);
        });
        expect(mocks.chest).toHaveBeenCalledTimes(1); expect(mocks.applyChest).toHaveBeenCalledTimes(1);
        expect(mocks.synth).toHaveBeenCalledTimes(1); expect(mocks.applySynth).toHaveBeenCalledTimes(1);
        expect(mocks.chest.mock.calls[0][2].expectedUserId).toBe('a');
        expect(mocks.synth.mock.calls[0][2].expectedUserId).toBe('a');
    });
    it('旧Aの応答はBの進行中表示・結果・再試行を変更しない', async () => {
        const old = deferred<unknown>(); const current = deferred<unknown>();
        mocks.chest.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        await mount();
        let a!: Promise<unknown>; let b!: Promise<unknown>;
        await act(async () => { a = chest.openChest('chest'); });
        await act(async () => { mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b'); });
        expect(chest.openingChestId).toBeNull(); expect(chest.errorChestId).toBeNull();
        await act(async () => { b = chest.openChest('chest'); });
        await act(async () => { old.resolve({ itemId: 'a', templateId: 'wooden_sword' }); await a; });
        expect(mocks.applyChest).not.toHaveBeenCalled(); expect(chest.openingChestId).toBe('chest');
        expect(mocks.chest.mock.calls[0][2].isActive()).toBe(false);
        expect(mocks.chest.mock.calls[0][1]).not.toBe(mocks.chest.mock.calls[1][1]);
        await act(async () => { current.resolve({ itemId: 'b', templateId: 'wooden_sword', starterCharacter: false }); await b; });
        expect(mocks.applyChest).toHaveBeenCalledExactlyOnceWith('chest', 'b', 'wooden_sword', false);
    });
    it('認証確認待ちのログアウトでは送信もローカル開封もしない', async () => {
        const auth = deferred<unknown>(); mocks.auth.mockReturnValueOnce(auth.promise);
        await mount();
        let opening!: Promise<unknown>;
        await act(async () => { opening = chest.openChest('chest'); await notifyLogout(); });
        await act(async () => { auth.resolve({ kind: 'authenticated', userId: 'a' }); await opening; });
        expect(mocks.chest).not.toHaveBeenCalled(); expect(mocks.localChest).not.toHaveBeenCalled();
        expect(chest.errorChestId).toBeNull();
    });
    it('合成失敗の再試行は、変更されない素材コピーと同じ操作IDを使う', async () => {
        mocks.synth.mockRejectedValueOnce(new TypeError('response lost'));
        await mount();
        const ids = ['one', 'two', 'three'];
        await act(async () => { const first = synth.synthesize(ids); ids.push('different'); await first; });
        expect(synth.hasError).toBe(true);
        await act(async () => { await notifyLogin('a'); await synth.retry(); });
        expect(mocks.synth.mock.calls.map(([items]) => items)).toEqual([['one', 'two', 'three'], ['one', 'two', 'three']]);
        expect(mocks.synth.mock.calls[0][1]).toBe(mocks.synth.mock.calls[1][1]);
        expect(mocks.applySynth).toHaveBeenCalledTimes(1); expect(synth.hasError).toBe(false);
        await act(async () => { await synth.retry(); });
        expect(mocks.synth).toHaveBeenCalledTimes(2);
    });
    it.each([null, 400, 401, 403, 404, 409, 429])('認証済み合成の%sをローカル報酬へ変換しない', async (status) => {
        if (status === null) mocks.synth.mockResolvedValue(null);
        else mocks.synth.mockRejectedValue(new EdgeFunctionError('http-error', 'rejected', status));
        await mount(); await act(async () => { await synth.synthesize(['one', 'two', 'three']); });
        expect(mocks.localSynth).not.toHaveBeenCalled(); expect(mocks.applySynth).not.toHaveBeenCalled();
        expect(synth.hasError).toBe(true);
    });
    it('認証済みの旧ローカル宝箱でも404を端末抽選へ変換しない', async () => {
        mocks.chest.mockRejectedValue(new EdgeFunctionError('http-error', 'not found', 404));
        await mount(); await act(async () => { await chest.openChest('chest'); });
        expect(mocks.localChest).not.toHaveBeenCalled(); expect(chest.errorChestId).toBe('chest');
    });
    it('匿名確定時はクラウドへ送らずローカル利用を維持する', async () => {
        await notifyLogout(); mocks.auth.mockResolvedValue({ kind: 'anonymous' });
        await mount(); await act(async () => { await chest.openChest('chest'); await synth.synthesize(['one', 'two', 'three']); });
        expect(mocks.localChest).toHaveBeenCalledTimes(1); expect(mocks.localSynth).toHaveBeenCalledTimes(1);
        expect(mocks.chest).not.toHaveBeenCalled(); expect(mocks.synth).not.toHaveBeenCalled();
    });
    it('認証判定不能ではローカル処理にも送信にも進まない', async () => {
        mocks.auth.mockResolvedValue({ kind: 'unavailable' }); await mount();
        await act(async () => { await chest.openChest('chest'); await synth.synthesize(['one', 'two', 'three']); });
        expect(mocks.localChest).not.toHaveBeenCalled(); expect(mocks.localSynth).not.toHaveBeenCalled();
        expect(mocks.chest).not.toHaveBeenCalled(); expect(mocks.synth).not.toHaveBeenCalled();
    });
    it('合成応答待ちのA→logout→Aで旧結果とretry状態を復活させない', async () => {
        const old = deferred<unknown>(); mocks.synth.mockReturnValueOnce(old.promise); await mount();
        let sending!: Promise<unknown>;
        await act(async () => { sending = synth.synthesize(['one', 'two', 'three']); });
        await act(async () => { await notifyLogout(); await notifyLogin('a'); });
        await act(async () => { old.resolve({ resultId: 'old', templateId: 'wooden_sword' }); await sending; await synth.retry(); });
        expect(mocks.applySynth).not.toHaveBeenCalled(); expect(synth.hasError).toBe(false);
        expect(mocks.synth).toHaveBeenCalledTimes(1);
    });
    it('アンマウント後の応答をストアへ適用しない', async () => {
        const old = deferred<unknown>(); mocks.chest.mockReturnValueOnce(old.promise); await mount();
        let opening!: Promise<unknown>;
        await act(async () => { opening = chest.openChest('chest'); });
        await act(async () => root.unmount()); mounted = false;
        await act(async () => { old.resolve({ itemId: 'old', templateId: 'wooden_sword' }); await opening; });
        expect(mocks.applyChest).not.toHaveBeenCalled();
    });
});
