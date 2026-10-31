import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createInactiveCloudSyncState, deriveCloudSyncAttention, type CloudSyncPublicState } from '@life-quest/core/cloudSyncState';
import { CloudSyncSettings } from './CloudSyncSettings';

const mocks = vi.hoisted(() => ({ sync: vi.fn(), listeners: new Set<(state: CloudSyncPublicState) => void>() }));
let state: CloudSyncPublicState;
vi.mock('../../platform/cloudSync', () => ({
    getWebCloudSyncState: () => state,
    subscribeWebCloudSyncState: (listener: (state: CloudSyncPublicState) => void) => {
        mocks.listeners.add(listener); listener(state); return () => { mocks.listeners.delete(listener); };
    }, syncWebNow: mocks.sync,
}));
let root: Root | null;
let host: HTMLDivElement;
function ready(): CloudSyncPublicState {
    const result = createInactiveCloudSyncState();
    result.availability = 'ready'; result.push.availability = 'ready';
    result.pull.lastSuccessAt = '2026-10-17T00:00:00Z'; return result;
}
function publish(next: CloudSyncPublicState) {
    state = { ...next, attention: deriveCloudSyncAttention(next.push, next.pull) };
    act(() => { for (const listener of mocks.listeners) listener(state); });
}
function button() { return host.querySelector<HTMLButtonElement>('button')!; }
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.sync.mockReset().mockResolvedValue(undefined); mocks.listeners.clear();
    state = ready(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    act(() => root!.render(<StrictMode><CloudSyncSettings /></StrictMode>));
});
afterEach(() => {
    act(() => root?.unmount()); host.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals();
});

describe('CloudSyncSettingsの実描画/操作', () => {
    it('成功済みidleなら日時と同期済みを表示し、手動同期できる', async () => {
        expect(host.textContent).toContain('同期済み'); expect(host.textContent).toContain('最終確認:');
        expect(button().disabled).toBe(false);
        await act(async () => { button().click(); }); expect(mocks.sync).toHaveBeenCalledTimes(1);
    });
    it('確認中は前回成功があっても同期済みと表示せず、busy/disabledにする', () => {
        publish({ ...ready(), pull: { phase: 'pulling', lastSuccessAt: '2026-10-17T00:00:00Z' } });
        expect(host.textContent).not.toContain('同期済み'); expect(host.textContent).toContain('確認しています');
        expect(button().textContent).toBe('同期中'); expect(button().disabled).toBe(true);
        expect(button().getAttribute('aria-busy')).toBe('true');
        act(() => button().click()); expect(mocks.sync).not.toHaveBeenCalled();
    });
    it('offlineには保留件数を示し、同期を勧めない', () => {
        const current = ready(); current.availability = 'offline'; current.push.pending = 2; publish(current);
        expect(host.textContent).toContain('オフライン'); expect(host.textContent).toContain('2件');
        expect(button().disabled).toBe(true); expect(button().textContent).toBe('今すぐ同期');
    });
    it('再ログイン待ちはalertとなり同期ボタンでは解除できない', () => {
        const current = ready(); current.availability = 'auth-required'; current.push.failureKinds = ['auth-required']; publish(current);
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('再ログイン'); expect(button().disabled).toBe(true);
    });
    it('pushが空でも受信の認証待ちは再ログインを案内し同期ボタンを無効化する', () => {
        const current = ready(); current.pull.phase = 'auth-required'; publish(current);
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('再ログイン');
        expect(button().disabled).toBe(true);
    });
    it('一時失敗では再試行を案内し、競合は自動再送されないと区別する', () => {
        publish({ ...ready(), pull: { phase: 'failed', lastSuccessAt: null } });
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('再試行'); expect(button().disabled).toBe(false);
        const conflict = ready(); conflict.push.conflict = 1; publish(conflict);
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('自動再送しません');
    });
    it('通信失敗として公開された後、次の試行を操作できる', async () => {
        const gate = deferred(); mocks.sync.mockReturnValueOnce(gate.promise);
        act(() => button().click()); expect(button().disabled).toBe(true);
        publish({ ...ready(), pull: { phase: 'failed', lastSuccessAt: null } });
        await act(async () => { gate.resolve(); });
        expect(button().disabled).toBe(false);
        await act(async () => { button().click(); }); expect(mocks.sync).toHaveBeenCalledTimes(2);
    });
    it('旧AのfinallyはBの進行中ボタンを解除しない', async () => {
        const a = deferred(); const b = deferred(); mocks.sync.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
        act(() => button().click());
        await act(async () => { await notifyLogin('b'); });
        publish(ready()); expect(button().disabled).toBe(false);
        act(() => button().click());
        await act(async () => { a.resolve(); });
        expect(button().disabled).toBe(true); expect(button().textContent).toBe('同期中');
        await act(async () => { b.resolve(); }); expect(button().disabled).toBe(false);
    });
    it('unmountで購読解除し、旧要求完了が別画面へ影響しない', async () => {
        const gate = deferred(); mocks.sync.mockReturnValueOnce(gate.promise);
        act(() => button().click());
        act(() => { root!.unmount(); root = null; }); expect(mocks.listeners.size).toBe(0);
        await act(async () => gate.resolve()); expect(host.textContent).toBe('');
    });
});
