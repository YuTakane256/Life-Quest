import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: (_value: string) => {}, back: vi.fn(), mode: 'standard' as 'standard' | 'reduced' | 'system', scroll: vi.fn(),
    capture: (value: unknown) => { const props = value as Record<string, unknown> | null; if (props?.['aria-label'] === 'ヘルプをキーワードで検索') mocks.query = (value) => (props.onChange as (event: unknown) => void)({ target: { value } }); },
}));
vi.mock('react/jsx-runtime', async (original) => { const module = await original<typeof import('react/jsx-runtime')>(); return { ...module,
    jsx: (...args: Parameters<typeof module.jsx>) => { mocks.capture(args[1]); return module.jsx(...args); }, jsxs: (...args: Parameters<typeof module.jsxs>) => { mocks.capture(args[1]); return module.jsxs(...args); },
}; });
vi.mock('react/jsx-dev-runtime', async (original) => { const module = await original<typeof import('react/jsx-dev-runtime')>(); return { ...module,
    jsxDEV: (...args: Parameters<typeof module.jsxDEV>) => { mocks.capture(args[1]); return module.jsxDEV(...args); },
}; });
vi.mock('../hooks/useBackWithFallback', () => ({ useBackWithFallback: () => mocks.back }));
vi.mock('../stores/useMotionStore', () => ({ useMotionStore: { getState: () => ({ mode: mocks.mode }) } }));
import { HelpPage } from './HelpPage';

let host: HTMLDivElement; let root: Root;
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const render = () => act(() => root.render(createElement(StrictMode, {}, createElement(HelpPage))));
const query = (value: string) => act(() => mocks.query(value));
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); mocks.mode = 'standard';
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: function(this: Element, options: unknown) { mocks.scroll(this.id, options); } });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); Reflect.deleteProperty(Element.prototype, 'scrollIntoView'); vi.unstubAllGlobals(); });
describe('Webヘルプの検索・キーボード移動', () => {
    it('検索結果だけをナビゲーションに表示する', () => {
        render(); query('通知'); expect(host.textContent).toContain('1件のヘルプセクション'); expect(button('タスクへ移動する')).toBeNull();
        expect(button('通知へ移動する')).not.toBeNull(); expect(host.querySelector('[aria-label="ヘルプをキーワードで検索"]')?.getAttribute('aria-controls')).toBe('help-results');
    });
    it('該当なしから全表示へ戻り検索欄へフォーカスを戻す', () => {
        render(); query('No matching help'); expect(host.textContent).toContain('一致する項目がありません');
        const showAll = [...host.querySelectorAll('button')].find((node) => node.textContent === 'すべての使い方を表示')!;
        act(() => showAll.click()); expect(host.textContent).toContain('8件のヘルプセクション'); expect(document.activeElement?.getAttribute('aria-label')).toBe('ヘルプをキーワードで検索');
    });
    it.each(['standard', 'reduced', 'system'] as const)('%s設定で対象の見出しへフォーカスを移す', (mode) => {
        mocks.mode = mode; vi.stubGlobal('matchMedia', () => ({ matches: true })); render();
        act(() => button('通知へ移動する').click()); expect(mocks.scroll).toHaveBeenCalledWith('help-heading-notifications', { behavior: mode === 'standard' ? 'smooth' : 'instant', block: 'start' });
        expect(document.activeElement?.id).toBe('help-heading-notifications');
    });
    it('クリアで全表示へ戻し、戻る操作を維持する', () => {
        render(); query('XP'); act(() => button('検索をクリア').click()); expect(host.textContent).toContain('8件のヘルプセクション');
        act(() => button('戻る').click()); expect(mocks.back).toHaveBeenCalledOnce();
    });
});
