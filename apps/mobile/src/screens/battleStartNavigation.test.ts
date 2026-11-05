import { act, createElement, forwardRef, StrictMode, useEffect, useImperativeHandle, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { createBattleEngineState, type BattleActors } from '@life-quest/core/battle';
import RootLayout from '../../app/_layout';
import MapScreen from './MapScreen';
import { useMobileGameStore } from '../stores/useMobileGameStore';

const mocks = vi.hoisted(() => ({ route: 'map', auth: vi.fn(), start: vi.fn(), resolve: vi.fn() }));
vi.mock('../platform/auth', () => ({ getBattleAuthState: mocks.auth, getGameAuthState: mocks.auth,
    startAuthSessionListener: () => () => {}, startMobileAuthLinkListener: () => () => {} }));
vi.mock('../platform/battleCloud', () => ({ startCloudBattleAttempt: mocks.start, resolveCloudBattleAttempt: mocks.resolve }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../stores/useMobileLoginBonusStore', () => ({ beginMobileLoginBonusCloudSession: vi.fn(), clearMobileLoginBonusCloudSession: vi.fn() }));
vi.mock('../platform/cloudMigration', () => ({ registerMobileCloudMigrationHooks: () => () => {} }));
vi.mock('../platform/pendingCompletionFlush', () => ({ registerPendingCompletionFlush: () => () => {} }));
vi.mock('../platform/notifications', () => ({ registerNotificationChecks: () => () => {} }));
vi.mock('../platform/loginBonusCheck', () => ({ registerLoginBonusCheck: () => () => {} }));
vi.mock('../platform/cloudSync', () => ({ registerMobileCloudSyncHooks: () => () => {} }));
vi.mock('../platform/cloudOutbox', () => ({ registerMobileOutboxHooks: () => () => {} }));
vi.mock('../platform/canonicalSync', () => ({ startMobileCanonicalSync: () => ({ stop() {} }) }));
vi.mock('../stores/rewardSync', () => ({ startRewardSync: () => () => {} }));
vi.mock('../stores/statsLogSeed', () => ({ startStatsLogSeed: () => () => {} }));
vi.mock('../components/LoginBonusOverlay', () => ({ LoginBonusOverlay: () => null }));
vi.mock('../components/ChestOpeningOverlay', () => ({ ChestOpeningOverlay: () => null }));
vi.mock('../components/CloudSessionRecoveryGate', () => ({ CloudSessionRecoveryGate: () => null }));
vi.mock('../components/InventoryOperationsProvider', () => ({ InventoryOperationsProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('expo-router', () => ({
    usePathname: () => mocks.route === 'map' ? '/map' : '/tasks',
    Stack: Object.assign(() => mocks.route === 'map' ? createElement(MapScreen) : createElement('div', {}, 'tasks-route'), { Screen: () => null }),
    useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
}));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; accessibilityLabel?: string; onPress?: () => void; disabled?: boolean; ref?: React.Ref<HTMLDivElement> };
    const box = ({ children, accessibilityLabel, ref }: Props) => createElement('div', { 'aria-label': accessibilityLabel, ref }, children);
    return { View: box, ScrollView: box, Text: ({ children }: Props) => createElement('span', {}, children), Image: () => null,
        Pressable: ({ children, accessibilityLabel, onPress, disabled }: Props) => createElement('button', { 'aria-label': accessibilityLabel, onClick: onPress, disabled }, children),
        FlatList: forwardRef(({ data, ListHeaderComponent, renderItem }: { data: unknown[]; ListHeaderComponent: ReactNode; renderItem: (props: { item: unknown }) => ReactNode }, ref) => {
            useImperativeHandle(ref, () => ({ scrollToOffset() {} }));
            return createElement('div', {}, ListHeaderComponent, ...data.map((item, index) => createElement('div', { key: index }, renderItem({ item }))));
        }),
        StyleSheet: { create: <T,>(value: T) => value },
        AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    };
});
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => createElement('div', {}, children) }));
vi.mock('lucide-react-native', () => ({ Swords: () => null, ChevronRight: () => null, RotateCcw: () => null, Skull: () => null, Trophy: () => null }));
vi.mock('../theme/usePalette', async () => {
    const { LIGHT_THEME } = await import('@life-quest/core/designTokens');
    return { usePalette: () => ({ palette: LIGHT_THEME, resolvedTheme: 'light' }) };
});

const actors: BattleActors = { player: { attack: 10, defense: 5, maxHp: 100 }, playerLevel: 1, playerName: 'hero',
    enemy: { stage: 1, name: 'slime', maxHp: 500, attack: 2, defense: 1, xpReward: 5 } };
const attempt = (id = 'started', stage = 1) => ({ battleAttemptId: id, actors: { ...actors, enemy: { ...actors.enemy, stage } } });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { resolve, reject, promise }; }
let root: Root; let host: HTMLDivElement; let mounted: boolean;
function button(label: string) { return [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label); }
async function click(label: string) { const target = button(label); expect(target).toBeTruthy(); await act(async () => target!.click()); }
async function render(route = 'map') { mocks.route = route; mounted = true; await act(async () => root.render(createElement(StrictMode, {}, createElement(RootLayout)))); }
const startLabel = 'ステージ 1 スタート';
const retryLabel = 'バトル開始を再試行する';
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'a' }); mocks.start.mockImplementation(async (stage: number) => attempt('started', stage)); mocks.resolve.mockResolvedValue({ outcome: 'victory', granted: false });
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, activeBattle: null,
        lastLevelUp: null, battleProgress: { battleUnlocked: true, currentStage: 1, maxClearedStage: 0 } });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = false;
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); host.remove(); resetAuthLifecycleHooks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Mobile battle starts through the real root layout and map with a navigation stub', () => {
    it('keeps the failed stage/key after screen remount and retries only explicitly', async () => {
        mocks.start.mockRejectedValueOnce(new TypeError('lost response')); await render(); await click(startLabel);
        expect(button(retryLabel)).toBeTruthy(); await render('tasks'); await render(); expect(button(retryLabel)).toBeTruthy();
        expect(mocks.start).toHaveBeenCalledTimes(1); await click(retryLabel);
        expect(mocks.start).toHaveBeenCalledTimes(2); expect(mocks.start.mock.calls.map(([stage]) => stage)).toEqual([1, 1]);
        expect(mocks.start.mock.calls[0][1]).toBe(mocks.start.mock.calls[1][1]);
        expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe('started'); expect(useMobileGameStore.getState().character.totalXp).toBe(0);
    });
    it('keeps a failure received while away and reuses its key after returning', async () => {
        const pending = deferred<unknown>(); mocks.start.mockReturnValueOnce(pending.promise); await render(); await click(startLabel); await render('tasks');
        await act(async () => pending.reject(new TypeError('response lost while away')));
        expect(host.textContent).toContain('tasks-route'); await render(); expect(button(retryLabel)).toBeTruthy();
        expect(mocks.start).toHaveBeenCalledTimes(1); await click(retryLabel);
        expect(mocks.start).toHaveBeenCalledTimes(2); expect(mocks.start.mock.calls[0][1]).toBe(mocks.start.mock.calls[1][1]);
        expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe('started');
    });
    it('keeps an in-flight start exclusive after remount and accepts its late result while away without attacks', async () => {
        const pending = deferred<unknown>(); mocks.start.mockReturnValueOnce(pending.promise); await render(); await click(startLabel);
        await render('tasks'); await render(); expect(button(startLabel)?.disabled).toBe(true); await click(startLabel); expect(mocks.start).toHaveBeenCalledTimes(1);
        await render('tasks'); await act(async () => pending.resolve(attempt()));
        expect(host.textContent).toContain('tasks-route'); expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe('started');
        await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(useMobileGameStore.getState().activeBattle?.actions).toEqual([]);
        await render(); expect(host.textContent).toContain('slime'); await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(useMobileGameStore.getState().activeBattle?.actions).toEqual([{ type: 'attack' }]); expect(mocks.start).toHaveBeenCalledTimes(1);
    });
    it('retains a failed next-stage request without advancing progress or adding rewards', async () => {
        useMobileGameStore.setState({ activeBattle: { stage: 1, actors, state: { ...createBattleEngineState(actors), outcome: 'victory' },
            actions: [], battleAttemptId: null, rewardMode: 'cloud' }, battleProgress: { battleUnlocked: true, currentStage: 1, maxClearedStage: 1 } });
        mocks.start.mockRejectedValueOnce(new TypeError('lost')); await render(); await click('次へ');
        await render('tasks'); await render(); expect(button(retryLabel)).toBeTruthy(); await click(retryLabel);
        expect(mocks.start.mock.calls.map(([stage]) => stage)).toEqual([2, 2]); expect(mocks.start.mock.calls[0][1]).toBe(mocks.start.mock.calls[1][1]);
        expect(useMobileGameStore.getState().battleProgress).toEqual({ battleUnlocked: true, currentStage: 2, maxClearedStage: 1 });
        expect(useMobileGameStore.getState().activeBattle?.actors.enemy.stage).toBe(2);
        expect(useMobileGameStore.getState().character.totalXp).toBe(0); expect(mocks.resolve).not.toHaveBeenCalled();
    });
    it('does not release B’s pending start when the old A result arrives after navigation', async () => {
        const old = deferred<unknown>(); const current = deferred<unknown>(); mocks.start.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        await render(); await click(startLabel); await render('tasks');
        await act(async () => { mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b'); });
        await render(); await click(startLabel); await act(async () => old.resolve(attempt('old-a')));
        expect(useMobileGameStore.getState().activeBattle).toBeNull(); expect(button(startLabel)?.disabled).toBe(true);
        expect(mocks.start.mock.calls[1][2]).toBe('b'); await render('tasks'); await act(async () => current.resolve(attempt('new-b')));
        expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe('new-b'); expect(host.textContent).toContain('tasks-route');
    });
    it('does not apply an old A start after logout and A login while away', async () => {
        const pending = deferred<unknown>(); mocks.start.mockReturnValueOnce(pending.promise); await render(); await click(startLabel); await render('tasks');
        await act(async () => { await notifyLogout(); await notifyLogin('a'); pending.resolve(attempt('old-a')); });
        await render(); expect(useMobileGameStore.getState().activeBattle).toBeNull(); expect(button(startLabel)?.disabled).toBe(false);
    });
    it('keeps the pending operation through same-owner notifications while away', async () => {
        const pending = deferred<unknown>(); mocks.start.mockReturnValueOnce(pending.promise); await render(); await click(startLabel); await render('tasks');
        await act(async () => { await notifyLogin('a'); pending.resolve(attempt()); });
        expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe('started'); expect(host.textContent).toContain('tasks-route');
    });
    it('rejects a late start if another battle replaced its source while away', async () => {
        const pending = deferred<unknown>(); mocks.start.mockReturnValueOnce(pending.promise); await render(); await click(startLabel); await render('tasks');
        await act(async () => { useMobileGameStore.getState().startCloudBattle(1, 'newer', actors); pending.resolve(attempt('old')); });
        expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe('newer'); await render(); expect(host.textContent).toContain('slime');
    });
    it('ignores a late response after the entire root layout unmounts', async () => {
        const pending = deferred<unknown>(); mocks.start.mockReturnValueOnce(pending.promise); await render(); await click(startLabel);
        await act(async () => root.unmount()); mounted = false; await act(async () => pending.resolve(attempt()));
        expect(useMobileGameStore.getState().activeBattle).toBeNull();
    });
    it('starts anonymous local battles without calling the cloud or granting rewards in advance', async () => {
        await notifyLogout(); mocks.auth.mockResolvedValue({ kind: 'anonymous' }); await render(); await click(startLabel);
        expect(useMobileGameStore.getState().activeBattle).toMatchObject({ stage: 1, rewardMode: 'local', battleAttemptId: null, actions: [] });
        expect(useMobileGameStore.getState().character.totalXp).toBe(0); expect(mocks.start).not.toHaveBeenCalled();
    });
    it('keeps the authentication-read lock after remount and rejects it when the owner changes', async () => {
        const auth = deferred<{ kind: 'authenticated'; userId: string }>(); mocks.auth.mockReturnValueOnce(auth.promise);
        await render(); await click(startLabel); await render('tasks'); await render(); expect(button(startLabel)?.disabled).toBe(true);
        await act(async () => { await notifyLogin('b'); auth.resolve({ kind: 'authenticated', userId: 'a' }); });
        expect(mocks.start).not.toHaveBeenCalled(); expect(useMobileGameStore.getState().activeBattle).toBeNull(); expect(button(startLabel)?.disabled).toBe(false);
    });
});
