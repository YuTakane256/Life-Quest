import { act, createElement, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { createEquipmentFromTemplate } from '@life-quest/core/equipment';
import { EQUIPMENT_POOL, type ChestReward } from '@life-quest/core/rewards';
import { useMobileGameStore, type MobileChestRevealEvent } from '../stores/useMobileGameStore';
import { useMobileLoginBonusStore } from '../stores/useMobileLoginBonusStore';
import { useMobileSettingsStore } from '../stores/useMobileSettingsStore';
import { ChestOpeningOverlay } from './ChestOpeningOverlay';
import { LoginBonusOverlay } from './LoginBonusOverlay';
import { useCloudChestOpen, type UseCloudChestOpenResult } from '../hooks/useCloudChestOpen';

const mocks = vi.hoisted(() => ({ push: vi.fn(), auth: vi.fn(), open: vi.fn(), animation: vi.fn(),
    motionListeners: new Set<(value: boolean) => void>(), reduced: vi.fn(async () => false) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../platform/auth', () => ({ getGameAuthState: mocks.auth }));
vi.mock('../platform/battleCloud', () => ({ openCloudChest: mocks.open }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../theme/usePalette', async () => {
    const { getMobileThemePalette } = await import('../theme/colors');
    return { usePalette: () => ({ palette: getMobileThemePalette('dark') }) };
});
vi.mock('react-native', async () => {
    const { createElement } = await import('react');
    type Props = { children?: ReactNode; visible?: boolean; accessibilityLabel?: string; accessibilityRole?: string;
        disabled?: boolean; onPress?: (event: React.MouseEvent) => void; onRequestClose?: () => void;
        style?: { minHeight?: number }; source?: unknown };
    const box = ({ children }: Props) => createElement('div', {}, children);
    const animation = () => ({ start: mocks.animation, stop: vi.fn() });
    class Value { setValue() {} interpolate() { return '0deg'; } }
    return {
        View: box, ScrollView: box, Text: ({ children }: Props) => createElement('span', {}, children),
        Image: ({ accessibilityLabel }: Props) => createElement('img', { alt: accessibilityLabel }),
        Modal: ({ visible, children, onRequestClose }: Props) => visible ? createElement('div', { role: 'dialog' },
            createElement('button', { 'aria-label': 'OS back', onClick: onRequestClose }), children) : null,
        Pressable: ({ children, accessibilityLabel, disabled, onPress, style }: Props) => createElement('div', {
            role: 'button', 'aria-label': accessibilityLabel, 'aria-disabled': disabled,
            style: { minHeight: style?.minHeight }, onClick: disabled ? undefined : onPress,
        }, children),
        StyleSheet: { create: <T>(value: T) => value, absoluteFill: {} },
        Animated: { Value, View: box, Image: ({ accessibilityLabel }: Props) => createElement('img', { alt: accessibilityLabel }),
            timing: animation, spring: animation, loop: animation, sequence: animation, parallel: animation },
        AccessibilityInfo: { isReduceMotionEnabled: mocks.reduced, addEventListener: (_: string, listener: (value: boolean) => void) => {
            mocks.motionListeners.add(listener); return { remove: () => mocks.motionListeners.delete(listener) };
        } },
    };
});

let root: Root | null;
let host: HTMLDivElement;
let opener: UseCloudChestOpenResult;
const equipment = createEquipmentFromTemplate('item', EQUIPMENT_POOL.find((item) => item.id === 'wooden_sword')!);
function event(id = 'reveal', starter = false): MobileChestRevealEvent {
    return { id, chestId: 'chest', chestType: starter ? 'blue' : 'wood', label: starter ? '青色の宝箱' : '木の宝箱',
        equipment: starter ? null : equipment, isStarterCharacter: starter };
}
const reveal = () => useMobileGameStore.getState().pendingChestReveal;
const bonus = () => ({ date: '2026-10-18', streak: 1, xp: 20, chestLabel: null });
const button = (label: string) => host.querySelector<HTMLElement>(`[role="button"][aria-label="${label}"]`);
function click(target: HTMLElement | null) { expect(target).not.toBeNull(); act(() => target!.click()); }
function advance(ms: number) { act(() => vi.advanceTimersByTime(ms)); }
function open() { click(button('宝箱を開ける')); advance(900); advance(1500); }
function mount(component = ChestOpeningOverlay) {
    act(() => root!.render(createElement(StrictMode, {}, createElement(component))));
}
function HookHarness() { opener = useCloudChestOpen(); return createElement(ChestOpeningOverlay); }
function unmount() { act(() => { root!.unmount(); root = null; }); }
function chest(overrides: Partial<ChestReward> = {}): ChestReward {
    return { id: 'chest', chestType: 'wood', label: '木の宝箱', equipment: null, opened: false, origin: 'local', ...overrides };
}

beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a');
    vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
    mocks.motionListeners.clear(); mocks.reduced.mockResolvedValue(false);
    mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'a' });
    mocks.open.mockReset();
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, activeBattle: null,
        lastLevelUp: null, pendingChestReveal: null, battleProgress: { battleUnlocked: false, currentStage: 1, maxClearedStage: 0 } });
    useMobileLoginBonusStore.setState({ pendingBonus: null, claimStatus: 'idle', claimMessage: null });
    useMobileSettingsStore.setState({ motionMode: 'standard' });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
    if (root) unmount();
    host.remove(); resetAuthLifecycleHooks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('Mobileログインボーナスの閉じる位置と所有者', () => {
    it('文字そのものが44pt以上の押せる範囲に含まれ、タップで閉じる', () => {
        useMobileLoginBonusStore.setState({ pendingBonus: bonus() }); mount(LoginBonusOverlay);
        const close = button('ログインボーナスを閉じる')!;
        expect(close.textContent).toContain('タップして閉じる'); expect(close.style.minHeight).toBe('44px');
        click(close.querySelector('span')); expect(useMobileLoginBonusStore.getState().pendingBonus).toBeNull();
    });
    it('新しい通知を古いclose callbackで消さない', () => {
        useMobileLoginBonusStore.setState({ pendingBonus: bonus() }); mount(LoginBonusOverlay);
        const old = button('ログインボーナスを閉じる')!; const next = bonus();
        act(() => { useMobileLoginBonusStore.setState({ pendingBonus: next }); old.click(); });
        expect(useMobileLoginBonusStore.getState().pendingBonus).toBe(next);
    });
    it('認証切替後は古い通知を隠し、OS backでも次の通知を消さない', async () => {
        useMobileLoginBonusStore.setState({ pendingBonus: bonus() }); mount(LoginBonusOverlay);
        await act(async () => notifyLogin('b')); expect(host.querySelector('[role="dialog"]')).toBeNull();
    });
});

describe('Mobile宝箱の表示だけの演出', () => {
    it('開く→900ms演出→装備/能力値表示、1500ms待って閉じる。装備を再付与しない', () => {
        useMobileGameStore.setState({ equipment: [equipment], pendingChestReveal: event() }); mount();
        expect(host.textContent).toContain('タップして開ける');
        click(button('宝箱を開ける')); expect(host.textContent).toContain('開封中…');
        advance(899); expect(button('インベントリに追加')).toBeNull();
        advance(1); expect(host.textContent).toContain(equipment.name); expect(host.textContent).toContain(`+${equipment.attackBonus}`);
        expect(button('インベントリに追加')?.getAttribute('aria-disabled')).toBe('true');
        click(button('インベントリに追加')); expect(reveal()).not.toBeNull();
        advance(1500); click(button('インベントリに追加')); expect(reveal()).toBeNull();
        expect(useMobileGameStore.getState().equipment).toEqual([equipment]);
    });
    it('青宝箱はキャラクター解放を説明し、バトルへ移動する', () => {
        useMobileGameStore.setState({ pendingChestReveal: event('starter', true) }); mount(); open();
        expect(host.textContent).toContain('キャラクター解放！'); expect(host.textContent).toContain('バトルが解放されました');
        click(button('バトルへ')); expect(mocks.push).toHaveBeenCalledWith('/(tabs)/map'); expect(reveal()).toBeNull();
        expect(useMobileGameStore.getState().equipment).toHaveLength(0);
    });
    it('初期/開封中のOS backは無視し、表示後のguardを守る', () => {
        useMobileGameStore.setState({ pendingChestReveal: event() }); mount();
        click(host.querySelector('[aria-label="OS back"]')); expect(reveal()).not.toBeNull();
        click(button('宝箱を開ける')); click(host.querySelector('[aria-label="OS back"]')); advance(900);
        click(host.querySelector('[aria-label="OS back"]')); expect(reveal()).not.toBeNull();
        advance(1500); click(host.querySelector('[aria-label="OS back"]')); expect(reveal()).toBeNull();
    });
    it('同じIDの新しい通知も旧phase/timerの対象にしない', () => {
        useMobileGameStore.setState({ pendingChestReveal: event() }); mount(); click(button('宝箱を開ける')); advance(500);
        const next = event(); act(() => { useMobileGameStore.setState({ pendingChestReveal: next }); vi.advanceTimersByTime(400); });
        expect(reveal()).toBe(next); expect(host.textContent).toContain('タップして開ける');
        expect(button('インベントリに追加')).toBeNull(); open(); expect(button('インベントリに追加')).not.toBeNull();
    });
    it('古い結果のボタンは新しい演出を閉じたり別画面へ移動したりしない', () => {
        useMobileGameStore.setState({ pendingChestReveal: event('starter', true) }); mount(); open();
        const old = button('バトルへ')!; const next = event('new');
        act(() => { useMobileGameStore.setState({ pendingChestReveal: next }); old.click(); });
        expect(reveal()).toBe(next); expect(mocks.push).not.toHaveBeenCalled();
    });
    it.each(['logout', 'switch'] as const)('%sで旧演出を隠してtimersを取り消す', async (transition) => {
        useMobileGameStore.setState({ pendingChestReveal: event() }); mount(); click(button('宝箱を開ける'));
        await act(async () => { if (transition === 'logout') await notifyLogout(); else await notifyLogin('b'); });
        advance(5000); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(mocks.push).not.toHaveBeenCalled();
    });
    it('unmountで演出timer・system motion購読を破棄する', () => {
        useMobileGameStore.setState({ pendingChestReveal: event() }); mount(); click(button('宝箱を開ける')); unmount();
        expect(vi.getTimerCount()).toBe(0); expect(mocks.motionListeners.size).toBe(0);
        advance(5000); expect(mocks.push).not.toHaveBeenCalled();
    });
    it('reduced motionでも同じ内容と操作を保ち、装飾animationは起動しない', () => {
        useMobileSettingsStore.setState({ motionMode: 'reduced' });
        useMobileGameStore.setState({ pendingChestReveal: event() }); mount(); open();
        expect(host.textContent).toContain(equipment.name); expect(mocks.animation).not.toHaveBeenCalled();
        click(button('インベントリに追加')); expect(reveal()).toBeNull();
    });
    it('system reduce motion変更にも追従して装飾だけを停止する', async () => {
        useMobileSettingsStore.setState({ motionMode: 'system' }); mocks.reduced.mockResolvedValue(true);
        useMobileGameStore.setState({ pendingChestReveal: event() });
        await act(async () => mount()); mocks.animation.mockClear();
        click(button('宝箱を開ける')); expect(mocks.animation).not.toHaveBeenCalled();
        act(() => { for (const listener of mocks.motionListeners) listener(false); });
        expect(mocks.animation).toHaveBeenCalled();
    });
});

describe('開封確定と演出の接続（本番ストア/本番フック）', () => {
    it('ローカル装備はcommit時だけ演出し、二度開いても再抽選しない', () => {
        useMobileGameStore.setState({ chestQueue: [chest()] }); const result = useMobileGameStore.getState().openChest('chest');
        expect(result).not.toBeNull(); expect(reveal()?.equipment).toEqual(result);
        const first = reveal(); useMobileGameStore.getState().openChest('chest');
        expect(reveal()).toBe(first); expect(useMobileGameStore.getState().equipment).toHaveLength(1);
    });
    it('スターターはgearなしでbattle解放イベントを作る', () => {
        useMobileGameStore.setState({ chestQueue: [chest({ chestType: 'blue', label: '青色の宝箱', isStarterCharacter: true })] });
        useMobileGameStore.getState().openChest('chest');
        expect(reveal()).toMatchObject({ equipment: null, isStarterCharacter: true });
        expect(useMobileGameStore.getState().battleProgress.battleUnlocked).toBe(true);
    });
    it('サーバー結果は同じitemIdを維持し、重複適用/既開封の調整で再演出しない', () => {
        useMobileGameStore.setState({ chestQueue: [chest({ origin: 'cloud' })] });
        useMobileGameStore.getState().applyCloudChestResult('chest', 'server-item', 'wooden_sword', false);
        expect(reveal()?.equipment?.id).toBe('server-item'); const first = reveal();
        useMobileGameStore.getState().applyCloudChestResult('chest', 'server-item', 'wooden_sword', false);
        expect(reveal()).toBe(first); expect(useMobileGameStore.getState().equipment).toHaveLength(1);
        useMobileGameStore.getState().clearPendingChestReveal(); useMobileGameStore.getState().discardSyncedChest('chest');
        expect(reveal()).toBeNull();
    });
    it('通信エラーでは演出せず、同じキーの再送成功で演出する', async () => {
        useMobileGameStore.setState({ chestQueue: [chest({ origin: 'cloud' })] });
        mocks.open.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({ itemId: 'server-item', templateId: 'wooden_sword', starterCharacter: false });
        mount(HookHarness); await act(async () => { await opener.openChest('chest'); });
        expect(reveal()).toBeNull(); expect(opener.errorChestId).toBe('chest');
        await act(async () => { await opener.retry(); });
        expect(reveal()?.equipment?.id).toBe('server-item'); expect(host.textContent).toContain('タップして開ける');
        expect(mocks.open.mock.calls[0].slice(0, 2)).toEqual(mocks.open.mock.calls[1].slice(0, 2));
    });
});
