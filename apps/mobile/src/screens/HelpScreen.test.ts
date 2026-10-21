import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Measured = (x: number, y: number, width: number, height: number) => void;
const mocks = vi.hoisted(() => ({
    query: (_value: string) => {}, submit: () => {}, blur: () => {}, focus: () => {}, drag: () => {},
    scroll: vi.fn(), dismiss: vi.fn(), inputFocus: vi.fn(), back: vi.fn(), replace: vi.fn(), canGoBack: true, reduced: false,
    dimensions: { width: 402, height: 874, fontScale: 1, scale: 1 },
    measure: vi.fn<(id: string, relative: { id: string }, success: Measured, failure: () => void) => void>(),
    press: new Map<string, () => void>(), styles: new Map<string, Record<string, unknown>>(),
}));
vi.mock('react-native', async () => {
    const { createElement: element, forwardRef, useImperativeHandle, useMemo } = await import('react');
    type Props = { children?: ReactNode; testID?: string; style?: Record<string, unknown>; accessibilityLabel?: string; accessibilityRole?: string;
        onPress?: () => void; value?: string; onChangeText?: (text: string) => void; onSubmitEditing?: () => void; onScrollBeginDrag?: () => void };
    const View = forwardRef(({ children, testID, style }: Props, ref) => {
        const node = useMemo(() => ({ id: testID ?? 'view', measureLayout: (relative: { id: string }, success: Measured, failure: () => void) => mocks.measure(testID!, relative, success, failure) }), [testID]);
        useImperativeHandle(ref, () => node, [node]); if (testID) mocks.styles.set(testID, style!);
        return element('div', { 'data-testid': testID }, children);
    });
    return { View, Text: ({ children, accessibilityRole, accessibilityLabel }: Props) => element('span', { role: accessibilityRole === 'header' ? 'heading' : undefined, 'aria-label': accessibilityLabel }, children),
        Pressable: ({ children, onPress, accessibilityLabel, style }: Props) => { mocks.press.set(accessibilityLabel!, onPress!); if (style && typeof style !== 'function') mocks.styles.set(accessibilityLabel!, style); return element('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children); },
        ScrollView: forwardRef(({ children, onScrollBeginDrag }: Props, ref) => { useImperativeHandle(ref, () => ({ scrollTo: mocks.scroll }), []); mocks.drag = onScrollBeginDrag!; return element('div', null, children); }),
        TextInput: forwardRef(({ value, onChangeText, onSubmitEditing, style, accessibilityLabel }: Props, ref) => { useImperativeHandle(ref, () => ({ focus: mocks.inputFocus }), []); mocks.query = onChangeText!; mocks.submit = onSubmitEditing!; mocks.styles.set('search', style!); return element('input', { value, readOnly: true, 'aria-label': accessibilityLabel }); }),
        StyleSheet: { create: <T,>(value: T) => value }, Keyboard: { dismiss: mocks.dismiss }, useWindowDimensions: () => mocks.dimensions,
    };
});
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));
vi.mock('expo-router', () => ({ router: { back: mocks.back, replace: mocks.replace, canGoBack: () => mocks.canGoBack }, useFocusEffect: (setup: () => (() => void) | undefined) => {
    useEffect(() => { let cleanup = setup(); mocks.blur = () => { cleanup?.(); cleanup = undefined; }; mocks.focus = () => { cleanup = setup(); }; return () => cleanup?.(); }, [setup]);
} }));
vi.mock('../theme/usePalette', async () => { const { LIGHT_THEME } = await import('@life-quest/core/designTokens'); return { usePalette: () => ({ palette: LIGHT_THEME }) }; });
vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => mocks.reduced }));
import HelpScreen from './HelpScreen';

let root: Root; let host: HTMLDivElement;
const render = () => act(() => root.render(createElement(StrictMode, {}, createElement(HelpScreen))));
const query = (value: string) => act(() => mocks.query(value));
const press = (label: string) => act(() => mocks.press.get(label)!());
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); mocks.press.clear(); mocks.styles.clear(); mocks.canGoBack = true; mocks.reduced = false;
    mocks.dimensions = { width: 402, height: 874, fontScale: 1, scale: 1 };
    mocks.measure.mockImplementation((_id, _relative, success) => success(0, 420, 350, 200));
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('Mobileヘルプの検索・移動と文字拡大', () => {
    it('表示中の結果だけに移動でき、該当なしから全表示へ戻せる', () => {
        render(); expect(host.textContent).toContain('8件のヘルプセクション'); query('通知');
        expect(host.textContent).toContain('1件のヘルプセクション'); expect(host.querySelector('[aria-label="タスクへ移動する"]')).toBeNull();
        query('No matching help'); expect(host.textContent).toContain('一致する項目がありません'); expect(host.querySelector('[aria-label="通知へ移動する"]')).toBeNull();
        press('すべての使い方を表示'); expect(host.textContent).toContain('8件のヘルプセクション'); expect(mocks.inputFocus).toHaveBeenCalledOnce();
    });
    it('リスト内の古い座標でなくscroll contentからの実座標へ移動しキーボードを閉じる', () => {
        render(); press('通知へ移動する');
        expect(mocks.measure).toHaveBeenCalledWith('help-section-notifications', expect.objectContaining({ id: 'help-scroll-content' }), expect.any(Function), expect.any(Function));
        expect(mocks.dismiss).toHaveBeenCalledOnce(); expect(mocks.scroll).toHaveBeenCalledWith({ y: 412, animated: true });
    });
    it('動きを減らす設定ではジャンプをアニメーションしない', () => {
        mocks.reduced = true; render(); press('タスクへ移動する'); expect(mocks.scroll).toHaveBeenCalledWith({ y: 412, animated: false });
    });
    it.each(['query', 'query-ABA', 'next-jump', 'resize', 'font-size', 'blur', 'unmount', 'drag'])('%s後は遅い計測を適用しない', (kind) => {
        let done!: Measured; mocks.measure.mockImplementation((_id, _relative, success) => { done = success; }); render(); press('通知へ移動する'); const old = done;
        if (kind === 'query') query('通知'); if (kind === 'query-ABA') { query('通知'); query(''); }
        if (kind === 'next-jump') press('タスクへ移動する');
        if (kind === 'resize') { mocks.dimensions.width = 320; render(); }
        if (kind === 'font-size') { mocks.dimensions.fontScale = 2; render(); }
        if (kind === 'blur') { act(() => { mocks.blur(); mocks.focus(); }); }
        if (kind === 'unmount') act(() => root.unmount()); if (kind === 'drag') act(() => mocks.drag());
        act(() => old(0, 900, 300, 100)); expect(mocks.scroll).not.toHaveBeenCalled();
    });
    it('計測失敗や不正な値でスクロールしない', () => {
        render(); mocks.measure.mockImplementationOnce((_id, _relative, _success, failure) => failure()); press('タスクへ移動する');
        mocks.measure.mockImplementationOnce((_id, _relative, success) => success(0, NaN, 300, 100)); press('習慣へ移動する'); expect(mocks.scroll).not.toHaveBeenCalled();
    });
    it('クリアと検索キーから復帰でき、入力欄の高さを固定しない', () => {
        render(); query('XP'); press('検索をクリア'); expect(mocks.inputFocus).toHaveBeenCalledOnce();
        act(() => mocks.submit()); expect(mocks.dismiss).toHaveBeenCalledOnce();
        expect(mocks.styles.get('search')).toMatchObject({ minHeight: 44, paddingRight: 52 }); expect(mocks.styles.get('search')).not.toHaveProperty('height');
    });
    it.each([true, false])('戻り履歴=%sで正しい戻り先を使う', (hasHistory) => {
        mocks.canGoBack = hasHistory; render(); press('戻る');
        expect(mocks.back).toHaveBeenCalledTimes(hasHistory ? 1 : 0); expect(mocks.replace).toHaveBeenCalledTimes(hasHistory ? 0 : 1);
        if (!hasHistory) expect(mocks.replace).toHaveBeenCalledWith('/settings');
    });
});
