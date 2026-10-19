import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskKeyboardVisibility } from './useTaskKeyboardVisibility';

type Measurement = (x: number, y: number, width: number, height: number) => void;
type Frame = { endCoordinates: { screenY: number } };
const mocks = vi.hoisted(() => ({
    input: { measureInWindow: vi.fn<(callback: Measurement) => void>() },
    active: null as unknown, metrics: null as { screenY: number } | null,
    platform: { OS: 'ios' }, listeners: new Map<string, (event: Frame) => void>(),
    remove: vi.fn(), scroll: vi.fn(),
}));
vi.mock('react-native', () => ({
    Platform: mocks.platform,
    TextInput: { State: { currentlyFocusedInput: () => mocks.active } },
    Keyboard: { metrics: () => mocks.metrics, addListener: (name: string, callback: (event: Frame) => void) => {
        mocks.listeners.set(name, callback); return { remove: mocks.remove };
    } },
}));
let host: HTMLDivElement; let root: Root | null;
let api: ReturnType<typeof useTaskKeyboardVisibility>;
const list = { current: { scrollToOffset: mocks.scroll } };
function Harness() { api = useTaskKeyboardVisibility(list, 76); return null; }
function frame(y = 600, name = 'keyboardDidShow') { act(() => mocks.listeners.get(name)?.({ endCoordinates: { screenY: y } })); }
function focus() { act(() => api.onInputFocus()); }
function scroll(y: number) { api.onScroll({ nativeEvent: { contentOffset: { y } } } as Parameters<typeof api.onScroll>[0]); }
function mount() { act(() => root!.render(createElement(Harness))); }
function unmount() { if (root) { act(() => root!.unmount()); root = null; } }
beforeEach(() => {
    vi.clearAllMocks(); mocks.listeners.clear(); mocks.metrics = null; mocks.platform.OS = 'ios'; mocks.active = mocks.input;
    mocks.input.measureInWindow.mockImplementation((callback) => callback(0, 590, 300, 42));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { unmount(); host.remove(); vi.unstubAllGlobals(); });

describe('タスク入力欄のキーボード回避', () => {
    it('キーボード表示後に入力欄全体と下部ボタン用の余白を確保する', () => {
        mount(); scroll(100); focus(); expect(mocks.scroll).not.toHaveBeenCalled(); frame();
        expect(mocks.scroll).toHaveBeenCalledWith({ offset: 208, animated: true });
    });
    it('すでに見える欄を不要にスクロールしない', () => {
        mocks.input.measureInWindow.mockImplementation((callback) => callback(0, 400, 300, 42));
        mount(); focus(); frame(); expect(mocks.scroll).not.toHaveBeenCalled();
    });
    it('キーボードを開いたまま別の欄へ移動しても回避する', () => {
        mount(); mocks.metrics = { screenY: 600 }; focus();
        expect(mocks.scroll).toHaveBeenCalledWith({ offset: 108, animated: true });
    });
    it('文字拡大で背の高い入力欄も、レイアウト確定後に全体を表示する', () => {
        mount(); focus(); frame(); mocks.scroll.mockClear();
        mocks.input.measureInWindow.mockImplementation((callback) => callback(0, 590, 300, 86));
        api.onLayout(); expect(mocks.scroll).toHaveBeenCalledWith({ offset: 152, animated: true });
    });
    it('キーボードの高さ変更にも追従する', () => {
        mount(); focus(); frame(); mocks.scroll.mockClear(); frame(550, 'keyboardDidChangeFrame');
        expect(mocks.scroll).toHaveBeenCalledWith({ offset: 158, animated: true });
    });
    it.each(['blur', 'other-input', 'hide', 'unmount', 'manual-scroll', 'new-measurement'] as const)('遅い計測結果を%s後に適用しない', (boundary) => {
        let finish: Measurement;
        mocks.input.measureInWindow.mockImplementation((callback) => { finish = callback; });
        mount(); focus(); frame();
        if (boundary === 'blur') api.onInputBlur();
        if (boundary === 'other-input') mocks.active = {};
        if (boundary === 'hide') frame(600, 'keyboardDidHide');
        if (boundary === 'unmount') unmount();
        if (boundary === 'manual-scroll') scroll(50);
        if (boundary === 'new-measurement') { const old = finish!; api.onLayout(); finish = old; }
        finish!(0, 590, 300, 42); expect(mocks.scroll).not.toHaveBeenCalled();
    });
    it('アンマウント時に購読を解除する', () => { mount(); unmount(); expect(mocks.remove).toHaveBeenCalledTimes(3); });
    it('未検証のAndroidの既存挙動を変更しない', () => {
        mocks.platform.OS = 'android'; mount(); focus(); expect(mocks.listeners.size).toBe(0); expect(mocks.scroll).not.toHaveBeenCalled();
    });
});
