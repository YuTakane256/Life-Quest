import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { SnackbarProvider } from './SnackbarProvider';
import { useSnackbar } from './snackbarContext';
import { useTaskUndoToast } from '../../../apps/mobile/src/hooks/useTaskUndoToast';

let root: Root | null;
let host: HTMLDivElement;
let showUndo: (message: string, callback: () => void) => void;
let mobile: ReturnType<typeof useTaskUndoToast>;
function WebConsumer() { showUndo = useSnackbar().showUndo; return null; }
function MobileConsumer() {
    mobile = useTaskUndoToast();
    showUndo = mobile.showUndo;
    return mobile.toast ? <button onClick={mobile.toast.onUndo}>{mobile.toast.message}</button> : null;
}
function webUndo() {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('元に戻す'))!;
    return () => button.click();
}
beforeEach(async () => {
    resetAuthLifecycleHooks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T03:00:00Z'));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await notifyLogin('a');
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
    act(() => { root?.unmount(); }); host.remove();
    resetAuthLifecycleHooks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe.each([
    { name: 'Web', mount: () => root!.render(<StrictMode><SnackbarProvider><WebConsumer /></SnackbarProvider></StrictMode>), capture: webUndo },
    { name: 'Mobile', mount: () => root!.render(<StrictMode><MobileConsumer /></StrictMode>), capture: () => mobile.toast!.onUndo },
])('$nameの取消UI（実Provider/hook、StrictMode）', (client) => {
    function show(callback = vi.fn()) {
        act(() => client.mount());
        act(() => showUndo('タスク名を含む取消', callback));
        return callback;
    }
    it('5秒以内の取消は一度だけ動く', () => {
        const undo = show(); const click = client.capture();
        act(() => { click(); click(); });
        expect(undo).toHaveBeenCalledTimes(1); expect(host.textContent).toBe('');
    });
    it('通常は5秒後に表示もタイマーも消える', () => {
        const undo = show();
        act(() => vi.advanceTimersByTime(4999)); expect(host.textContent).toContain('タスク名');
        act(() => vi.advanceTimersByTime(1)); expect(host.textContent).toBe(''); expect(undo).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('timer実行が遅れていても期限後の取消は動かない', () => {
        const undo = show(); const click = client.capture();
        vi.setSystemTime(Date.now() + 5000);
        act(() => click());
        expect(undo).not.toHaveBeenCalled();
    });
    it('認証変更通知後、React再描画前の旧ボタンも動かない', async () => {
        const undo = show(); const click = client.capture();
        await act(async () => { const transition = notifyLogin('b'); click(); await transition; });
        expect(undo).not.toHaveBeenCalled(); expect(host.textContent).toBe(''); expect(vi.getTimerCount()).toBe(0);
    });
    it('A→logout→A後の旧操作は無効、新通知は正常', async () => {
        const old = show(); const click = client.capture();
        await act(async () => { await notifyLogout(); await notifyLogin('a'); });
        const next = vi.fn(); act(() => showUndo('新しい取消', next));
        act(() => click()); expect(old).not.toHaveBeenCalled(); expect(host.textContent).toContain('新しい取消');
        act(() => client.capture()()); expect(next).toHaveBeenCalledTimes(1);
    });
    it('同一ユーザー再通知では表示と操作を維持する', async () => {
        const undo = show();
        await act(async () => { await notifyLogin('a'); });
        expect(host.textContent).toContain('タスク名');
        act(() => client.capture()()); expect(undo).toHaveBeenCalledTimes(1);
    });
    it('unmount時にタイマーを破棄し、保持された操作やshowUndoは無効', () => {
        const undo = show(); const click = client.capture(); const showOld = showUndo;
        act(() => { root!.unmount(); root = null; });
        act(() => { click(); showOld('旧画面', undo); vi.advanceTimersByTime(6000); });
        expect(undo).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });
});

it('Mobileは置き換えた旧toastから新toastを取消・消去しない', () => {
    act(() => root!.render(<MobileConsumer />));
    const old = vi.fn(); const next = vi.fn();
    act(() => showUndo('old', old)); const click = mobile.toast!.onUndo;
    act(() => vi.advanceTimersByTime(1000));
    act(() => showUndo('next', next));
    act(() => { click(); vi.advanceTimersByTime(4000); });
    expect(old).not.toHaveBeenCalled(); expect(host.textContent).toBe('next');
    act(() => mobile.toast!.onUndo()); expect(next).toHaveBeenCalledTimes(1);
});

it('Webは最大3件の取消を維持し、押し出した通知の操作とタイマーだけを破棄する', () => {
    act(() => root!.render(<StrictMode><SnackbarProvider><WebConsumer /></SnackbarProvider></StrictMode>));
    const old = vi.fn();
    act(() => showUndo('old', old)); const click = webUndo();
    const next = vi.fn();
    act(() => { showUndo('two', next); showUndo('three', next); showUndo('four', next); });
    expect(host.textContent).not.toContain('old'); expect(vi.getTimerCount()).toBe(3);
    act(() => click()); expect(old).not.toHaveBeenCalled();
    act(() => webUndo()()); expect(next).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(2);
});
