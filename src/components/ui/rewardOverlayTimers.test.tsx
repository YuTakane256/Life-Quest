import { StrictMode, act, useLayoutEffect, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { useGameStore } from '../../stores/useGameStore';
import { useLoginBonusStore } from '../../stores/useLoginBonusStore';
import { ChestOpeningOverlay } from './ChestOpeningOverlay';
import { LevelUpOverlay } from './LevelUpOverlay';
import { LoginBonusOverlay } from './LoginBonusOverlay';
import type { ChestRevealEvent, LevelUpEvent, LoginBonus } from '../../types';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const chest = (id: string): ChestRevealEvent => ({
    id, chestId: id, chestType: 'wood', label: id, equipment: null, isStarterCharacter: true,
});
const level = (id: string): LevelUpEvent => ({ id, fromLevel: 1, toLevel: 2, attackGain: 2, defenseGain: 1, hpGain: 5 });
const bonus = (): LoginBonus => ({ date: '2026-10-17', streak: 2, xp: 25, chestLabel: null });

let host: HTMLDivElement;
let root: Root | null;

function mount(Component: ComponentType) {
    act(() => { root!.render(<StrictMode><Component /></StrictMode>); });
}
function advance(ms: number) { act(() => { vi.advanceTimersByTime(ms); }); }
function click(element: Element | null) {
    expect(element).not.toBeNull();
    act(() => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
function escape() { act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); }); }
function revealChest() {
    click(host.firstElementChild);
    advance(900);
    advance(1500);
}

beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    resetAuthLifecycleHooks();
    await notifyLogin('a');
    navigate.mockReset();
    useGameStore.setState({ levelUpEvent: null, pendingChestReveal: null });
    useLoginBonusStore.setState({ pendingBonus: null, claimMessage: null, claimStatus: 'idle' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => { root?.unmount(); });
    root = null;
    host.remove();
    resetAuthLifecycleHooks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const overlays = [
    {
        name: '宝箱', Component: ChestOpeningOverlay,
        setEvent: () => { const event = chest('same-id'); useGameStore.setState({ pendingChestReveal: event }); return event; },
        getEvent: () => useGameStore.getState().pendingChestReveal,
        prepare: revealChest,
    },
    {
        name: 'レベルアップ', Component: LevelUpOverlay,
        setEvent: () => { const event = level('same-id'); useGameStore.setState({ levelUpEvent: event }); return event; },
        getEvent: () => useGameStore.getState().levelUpEvent,
        prepare: () => {},
    },
    {
        name: 'ログインボーナス', Component: LoginBonusOverlay,
        setEvent: () => { const event = bonus(); useLoginBonusStore.setState({ pendingBonus: event }); return event; },
        getEvent: () => useLoginBonusStore.getState().pendingBonus,
        prepare: () => {},
    },
];

describe('ログインボーナスの可視閉じるボタン', () => {
    it('文字の位置そのものを押すと閉じる（カード内の説明文ではない）', () => {
        useLoginBonusStore.setState({ pendingBonus: bonus() }); mount(LoginBonusOverlay);
        const button = host.querySelector('button[aria-label="ログインボーナスを閉じる"]');
        expect(button?.textContent).toContain('タップして閉じる');
        click(button); advance(300); expect(useLoginBonusStore.getState().pendingBonus).toBeNull();
    });
    it('カードの報酬表示を押しても閉じず、閉じるボタンをキーボード操作できる', () => {
        useLoginBonusStore.setState({ pendingBonus: bonus() }); mount(LoginBonusOverlay);
        click(host.querySelector('[role="dialog"]')); advance(300);
        expect(useLoginBonusStore.getState().pendingBonus).not.toBeNull();
        const button = host.querySelector<HTMLButtonElement>('button[aria-label="ログインボーナスを閉じる"]')!;
        button.focus(); expect(document.activeElement).toBe(button);
        expect(button.tagName).toBe('BUTTON'); expect(button.type).toBe('button');
        click(button); advance(300); expect(useLoginBonusStore.getState().pendingBonus).toBeNull();
    });
});

describe.each(overlays)('$nameの通知タイマー（実コンポーネント/実ストア、StrictMode）', (overlay) => {
    function show() { overlay.setEvent(); mount(overlay.Component); overlay.prepare(); }

    it('通常のEscape閉じは300ms後に対象の通知だけ消す', () => {
        show();
        escape();
        expect(overlay.getEvent()).not.toBeNull();
        advance(299);
        expect(overlay.getEvent()).not.toBeNull();
        advance(1);
        expect(overlay.getEvent()).toBeNull();
    });

    it('閉じる直後の新通知を消さない（同じID/日付の別インスタンスも区別）', () => {
        show();
        escape();
        advance(100);
        let next: object;
        // Store replacement occurs before React commits its effect cleanup.
        act(() => { next = overlay.setEvent(); vi.advanceTimersByTime(200); });
        expect(overlay.getEvent()).toBe(next!);
        expect(host.textContent).not.toBe('');
        overlay.prepare();
        escape();
        advance(300);
        expect(overlay.getEvent()).toBeNull();
    });

    it('unmount後に古い閉じる処理を実行しない', () => {
        show();
        escape();
        const event = overlay.getEvent();
        act(() => { root!.unmount(); root = null; });
        advance(300);
        expect(overlay.getEvent()).toBe(event);
    });

    it('A→logout→A後に古い閉じる処理を実行しない', async () => {
        show();
        escape();
        const event = overlay.getEvent();
        await act(async () => { await notifyLogout(); await notifyLogin('a'); });
        advance(300);
        expect(overlay.getEvent()).toBe(event);
    });

    it('同一ユーザーの再通知では有効な閉じる処理を維持する', async () => {
        show();
        escape();
        await act(async () => { await notifyLogin('a'); });
        advance(300);
        expect(overlay.getEvent()).toBeNull();
    });

    it('認証切替はストアの消去を待たず古い演出を隠し、新通知は通常どおり閉じられる', async () => {
        show();
        const previous = overlay.getEvent();
        await act(async () => { await notifyLogin('b'); });
        expect(host.textContent).toBe('');
        expect(overlay.getEvent()).toBe(previous);
        act(() => { overlay.setEvent(); });
        expect(host.textContent).not.toBe('');
        overlay.prepare();
        escape();
        advance(300);
        expect(overlay.getEvent()).toBeNull();
    });

    it('renderと購読開始の間に認証が切り替わっても古い演出を隠す', () => {
        overlay.setEvent();
        function TransitionOnCommit() {
            useLayoutEffect(() => { void notifyLogin('b'); }, []);
            return <overlay.Component />;
        }
        mount(TransitionOnCommit);
        expect(host.textContent).toBe('');
        advance(6000);
        expect(overlay.getEvent()).not.toBeNull();
    });
});

describe('レベルアップの自動閉じ', () => {
    it('4.5秒後に隠れ、さらに300ms後に通知を消す', () => {
        useGameStore.setState({ levelUpEvent: level('first') });
        mount(LevelUpOverlay);
        advance(4499);
        expect(host.querySelector('[role="dialog"]')).not.toBeNull();
        advance(1);
        expect(host.querySelector('[role="dialog"]')).toBeNull();
        advance(300);
        expect(useGameStore.getState().levelUpEvent).toBeNull();
    });

    it('新通知は前の通知の残り時間ではなく4.5秒間表示する', () => {
        useGameStore.setState({ levelUpEvent: level('first') });
        mount(LevelUpOverlay);
        advance(4400);
        act(() => { useGameStore.setState({ levelUpEvent: level('next') }); });
        advance(100);
        expect(host.querySelector('[role="dialog"]')).not.toBeNull();
        advance(4399);
        expect(host.querySelector('[role="dialog"]')).not.toBeNull();
        advance(1);
        expect(host.querySelector('[role="dialog"]')).toBeNull();
    });
});

describe('宝箱の段階演出と画面移動', () => {
    it('新しい宝箱はidleから開始し、前の開封タイマーで先へ進まない', () => {
        useGameStore.setState({ pendingChestReveal: chest('first') });
        mount(ChestOpeningOverlay);
        click(host.firstElementChild);
        advance(800);
        act(() => { useGameStore.setState({ pendingChestReveal: chest('next') }); });
        advance(100);
        expect(host.textContent).toContain('タップして開ける');
        expect(host.textContent).not.toContain('キャラクター解放！');
    });

    it('バトルへは100ms後に移動して300ms後に閉じる', () => {
        useGameStore.setState({ pendingChestReveal: chest('first') });
        mount(ChestOpeningOverlay);
        revealChest();
        click([...host.querySelectorAll('button')].find((b) => b.textContent?.includes('バトルへ'))!);
        advance(99);
        expect(navigate).not.toHaveBeenCalled();
        advance(1);
        expect(navigate).toHaveBeenCalledExactlyOnceWith('/map');
        advance(200);
        expect(useGameStore.getState().pendingChestReveal).toBeNull();
    });

    it.each(['replace', 'unmount', 'account'] as const)('%s後に古いバトルへの移動を実行しない', async (change) => {
        useGameStore.setState({ pendingChestReveal: chest('first') });
        mount(ChestOpeningOverlay);
        revealChest();
        click([...host.querySelectorAll('button')].find((b) => b.textContent?.includes('バトルへ'))!);
        if (change === 'replace') act(() => { useGameStore.setState({ pendingChestReveal: chest('next') }); });
        if (change === 'unmount') act(() => { root!.unmount(); root = null; });
        if (change === 'account') await act(async () => { await notifyLogin('b'); });
        const event = useGameStore.getState().pendingChestReveal;
        advance(300);
        expect(navigate).not.toHaveBeenCalled();
        expect(useGameStore.getState().pendingChestReveal).toBe(event);
    });
});
