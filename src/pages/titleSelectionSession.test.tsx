import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { useGameStore } from '../stores/useGameStore';
import { useStatsStore } from '../stores/useStatsStore';
import { useTitleStore } from '../stores/useTitleStore';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';
import { useMobileStatsStore } from '../../apps/mobile/src/stores/useMobileStatsStore';
import { useMobileTitleStore } from '../../apps/mobile/src/stores/useMobileTitleStore';
import { StatsPage } from './StatsPage';
import StatsScreen from '../../apps/mobile/src/screens/StatsScreen';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(async () => true), presses: new Map<string, () => void>(),
    blur: new Set<() => void>(), focus: new Set<() => void>() }));
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isWebCloudOutboxActive: () => false }));
vi.mock('../../apps/mobile/src/platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isCloudOutboxActive: () => false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../hooks/useJstToday', () => ({ useJstToday: () => '2026-08-10' }));
vi.mock('../../apps/mobile/src/hooks/useJstToday', () => ({ useJstToday: () => '2026-08-10' }));
vi.mock('../../apps/mobile/src/theme/usePalette', async () => { const { DARK_THEME } = await import('@life-quest/core/designTokens'); return { usePalette: () => ({ palette: DARK_THEME }) }; });
vi.mock('expo-router', () => ({ useFocusEffect: (setup: () => void | (() => void)) => {
    useEffect(() => {
        let cleanup = setup(); const blur = () => { cleanup?.(); cleanup = undefined; }; const focus = () => { cleanup = setup(); };
        mocks.blur.add(blur); mocks.focus.add(focus);
        return () => { cleanup?.(); mocks.blur.delete(blur); mocks.focus.delete(focus); };
    }, [setup]);
} }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children?: ReactNode }) => createElement('div', {}, children) }));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; accessibilityLabel?: string; accessibilityState?: { selected?: boolean }; disabled?: boolean; onPress?: () => void; visible?: boolean };
    const box = ({ children }: Props) => createElement('div', {}, children);
    return { View: box, ScrollView: box, Text: ({ children }: Props) => createElement('span', {}, children), StyleSheet: { create: <T,>(value: T) => value },
        Modal: ({ visible, children }: Props) => visible ? createElement('div', { role: 'dialog' }, children) : null,
        Pressable: ({ children, accessibilityLabel, accessibilityState, disabled, onPress }: Props) => {
            if (accessibilityLabel && onPress) mocks.presses.set(accessibilityLabel, onPress);
            return createElement('button', { 'aria-label': accessibilityLabel, 'aria-pressed': accessibilityState?.selected, disabled, onClick: onPress }, children);
        },
    };
});

let host: HTMLDivElement; let root: Root | null;
const worker = '習慣の芽'; const starter = '駆け出し冒険者';
const sevenDays = () => Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`2026-08-0${index + 1}`, 10]));
function unmount() { if (root) act(() => { root!.unmount(); root = null; }); }
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
    useGameStore.setState({ ...useGameStore.getInitialState(), character: { ...useGameStore.getInitialState().character, totalXp: 60 } });
    useMobileGameStore.setState({ ...useMobileGameStore.getInitialState(), character: { ...useMobileGameStore.getInitialState().character, totalXp: 60 }, hasHydrated: true });
    useStatsStore.setState({ taskXpLog: sevenDays(), habitLog: {} }); useMobileStatsStore.setState({ taskXpLog: sevenDays(), habitLog: {}, hasHydrated: true });
    useTitleStore.setState({ activeTitle: null }); useMobileTitleStore.setState({ activeTitle: null });
    vi.clearAllMocks(); mocks.presses.clear();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { unmount(); host.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals(); });

for (const mobile of [false, true]) describe(`title selection lifetime mobile=${mobile}`, () => {
    const title = mobile ? useMobileTitleStore : useTitleStore;
    const game = mobile ? useMobileGameStore : useGameStore;
    const stats = mobile ? useMobileStatsStore : useStatsStore;
    const mount = () => act(() => root!.render(createElement(StrictMode, {}, createElement(mobile ? StatsScreen : StatsPage))));
    const capture = (name: string) => {
        const label = name === '' ? '称号なしを選択する' : `「${name}」を選択する`;
        const node = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!; expect(node).toBeTruthy();
        return mobile ? mocks.presses.get(label)! : () => node.click();
    };
    it.each(['logout', 'switch', 'roundtrip'] as const)('rejects old selection on %s before rerender', async (transition) => {
        mount(); const old = capture(worker);
        await act(async () => {
            if (transition === 'logout') await notifyLogout();
            else if (transition === 'switch') await notifyLogin('b');
            else { await notifyLogout(); await notifyLogin('a'); }
            title.setState({ activeTitle: null }); old();
        });
        expect(title.getState().activeTitle).toBeNull(); expect(mocks.enqueue).not.toHaveBeenCalled();
        act(capture(worker)); expect(title.getState().activeTitle).toBe(worker); expect(mocks.enqueue).toHaveBeenCalledOnce();
    });
    it('saves one approved selection, preserves progress/logs and skips reselecting the active value', () => {
        mount(); const beforeGame = JSON.stringify(game.getState()); const beforeLogs = JSON.stringify(stats.getState());
        const old = capture(worker); act(() => { old(); old(); });
        expect(title.getState().activeTitle).toBe(worker); expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith('upsert_profile', {
            p_display_name: null, p_avatar: null, p_active_title: worker, p_base_version: null,
        });
        expect(JSON.stringify(game.getState())).toBe(beforeGame); expect(JSON.stringify(stats.getState())).toBe(beforeLogs);
        mocks.enqueue.mockClear(); act(capture(worker)); expect(mocks.enqueue).not.toHaveBeenCalled();
        act(capture('')); expect(title.getState().activeTitle).toBeNull(); expect(mocks.enqueue).toHaveBeenCalledOnce();
        mocks.enqueue.mockClear(); act(capture('')); expect(mocks.enqueue).not.toHaveBeenCalled();
    });
    it.each(['logout', 'switch', 'roundtrip'] as const)('old clear does not remove the next session title on %s', async (transition) => {
        title.setState({ activeTitle: starter }); mount(); const clear = capture('');
        await act(async () => {
            if (transition === 'logout') await notifyLogout();
            else if (transition === 'switch') await notifyLogin('b');
            else { await notifyLogout(); await notifyLogin('a'); }
            title.setState({ activeTitle: starter }); clear();
        });
        expect(title.getState().activeTitle).toBe(starter); expect(mocks.enqueue).not.toHaveBeenCalled();
    });
    it('does not choose a title whose achievement disappeared before rerender', () => {
        mount(); const old = capture(worker);
        act(() => { stats.setState({ taskXpLog: {} }); old(); });
        expect(title.getState().activeTitle).toBeNull(); expect(mocks.enqueue).not.toHaveBeenCalled();
    });
    it('does not overwrite a newer synchronized title', () => {
        mount(); const old = capture(worker);
        act(() => { title.setState({ activeTitle: '同期で選択された称号' }); old(); });
        expect(title.getState().activeTitle).toBe('同期で選択された称号'); expect(mocks.enqueue).not.toHaveBeenCalled();
    });
    it('keeps stored locked titles while browsing and refuses an old clear when no choices remain', () => {
        title.setState({ activeTitle: '以前の称号' }); mount(); const clear = capture('');
        act(() => {
            stats.setState({ taskXpLog: {}, habitLog: {} });
            if (mobile) useMobileGameStore.setState({ character: { ...useMobileGameStore.getState().character, totalXp: 0 } });
            else useGameStore.setState({ character: { ...useGameStore.getState().character, totalXp: 0 } });
            clear();
        });
        expect(title.getState().activeTitle).toBe('以前の称号'); expect(mocks.enqueue).not.toHaveBeenCalled();
    });
    it('accepts the same session, equal pulls and unrelated progress without editing logs', async () => {
        mount(); const old = capture(worker);
        await act(async () => {
            await notifyLogin('a'); stats.setState({ taskXpLog: { ...sevenDays(), '2026-08-08': 15 } });
            if (mobile) useMobileGameStore.setState({ character: { ...useMobileGameStore.getState().character, totalXp: 80 } });
            else useGameStore.setState({ character: { ...useGameStore.getState().character, totalXp: 80 } });
            old();
        });
        expect(title.getState().activeTitle).toBe(worker); expect(mocks.enqueue).toHaveBeenCalledOnce();
    });
    if (mobile) {
        it.each(['game', 'stats'] as const)('refuses an old press while %s is hydrating, then allows fresh controls', (store) => {
            mount(); const old = capture(worker);
            act(() => { if (store === 'game') useMobileGameStore.setState({ hasHydrated: false }); else useMobileStatsStore.setState({ hasHydrated: false }); old(); });
            expect(title.getState().activeTitle).toBeNull(); expect(mocks.enqueue).not.toHaveBeenCalled();
            act(() => { if (store === 'game') useMobileGameStore.setState({ hasHydrated: true }); else useMobileStatsStore.setState({ hasHydrated: true }); });
            act(capture(worker)); expect(title.getState().activeTitle).toBe(worker); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it('rejects retained presses after blur/refocus or unmount', () => {
            mount(); const old = capture(worker);
            act(() => { mocks.blur.forEach((blur) => blur()); mocks.focus.forEach((focus) => focus()); old(); });
            expect(mocks.enqueue).not.toHaveBeenCalled(); const fresh = capture(worker); unmount(); act(fresh);
            expect(mocks.enqueue).not.toHaveBeenCalled();
        });
    }
});
