import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJstToday as useWebDay } from './useJstToday';
import { useJstToday as useMobileDay } from '../../apps/mobile/src/hooks/useJstToday';

const native = vi.hoisted(() => ({ focused: true, appState: 'active', listeners: new Set<() => void>() }));
vi.mock('expo-router', () => ({ useFocusEffect: (setup: () => void | (() => void)) => {
    const focused = native.focused;
    useEffect(() => focused ? setup() : undefined, [focused, setup]);
} }));
vi.mock('react-native', () => ({ AppState: {
    get currentState() { return native.appState; },
    addEventListener: (_: string, listener: () => void) => { native.listeners.add(listener); return { remove: () => native.listeners.delete(listener) }; },
} }));

let root: Root; let host: HTMLDivElement;
function Harness({ mobile }: { mobile: boolean }) { return mobile ? <Mobile /> : <Web />; }
function Mobile() { return <span>{useMobileDay()}</span>; }
function Web() { return <span>{useWebDay()}</span>; }
const render = (mobile: boolean) => act(() => root.render(<StrictMode><Harness mobile={mobile} /></StrictMode>));
beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-10T14:59:59.000Z'));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); native.focused = true; native.appState = 'active'; native.listeners.clear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, 'visibilityState'); });
describe.each([false, true])('JST表示時計 mobile=%s', (mobile) => {
    it('タイマーや復帰通知が遅れても通常の再描画では実際の日付を返す', () => {
        render(mobile); vi.setSystemTime(new Date('2026-08-12T00:00:00Z')); render(mobile);
        expect(host.textContent).toBe('2026-08-12'); expect(vi.getTimerCount()).toBe(1);
    });
    it('時計が往復しても復帰時に表示日が古いまま残らない', () => {
        render(mobile); vi.setSystemTime(new Date('2026-08-09T00:00:00Z')); render(mobile);
        expect(host.textContent).toBe('2026-08-09'); vi.setSystemTime(new Date('2026-08-10T00:00:00Z'));
        act(() => { if (mobile) for (const listener of native.listeners) listener(); else window.dispatchEvent(new Event('focus')); });
        expect(host.textContent).toBe('2026-08-10'); expect(vi.getTimerCount()).toBe(1);
    });
    it('StrictModeで時計を二重登録せず、データ更新なしでも午前0時に更新する', async () => {
        render(mobile); expect(host.textContent).toBe('2026-08-10'); expect(vi.getTimerCount()).toBe(1);
        await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(host.textContent).toBe('2026-08-11'); expect(vi.getTimerCount()).toBe(1);
    });
    it('背景では時計を止め、翌日の復帰時に即時更新する', () => {
        render(mobile);
        act(() => {
            if (mobile) { native.appState = 'background'; for (const listener of native.listeners) listener(); }
            else { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
        });
        expect(vi.getTimerCount()).toBe(0); vi.setSystemTime(new Date('2026-08-12T00:00:00Z'));
        act(() => {
            if (mobile) { native.appState = 'active'; for (const listener of native.listeners) listener(); }
            else { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }
        });
        expect(host.textContent).toBe('2026-08-12'); expect(vi.getTimerCount()).toBe(1);
    });
    it('アンマウントで時計と復帰リスナーを解除する', () => {
        render(mobile); act(() => root.unmount()); expect(vi.getTimerCount()).toBe(0); expect(native.listeners.size).toBe(0);
        act(() => window.dispatchEvent(new Event('focus'))); expect(vi.getTimerCount()).toBe(0);
    });
});
it('Nativeは別タブ中は監視せず、タブ復帰で即時更新する', () => {
    render(true); native.focused = false; render(true); expect(vi.getTimerCount()).toBe(0); expect(native.listeners.size).toBe(0);
    vi.setSystemTime(new Date('2026-08-12T00:00:00Z')); native.focused = true; render(true);
    expect(host.textContent).toBe('2026-08-12'); expect(vi.getTimerCount()).toBe(1);
});
