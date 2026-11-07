import { act, createElement, forwardRef, StrictMode, useEffect, useImperativeHandle, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { battleResultRecoveryKey } from '@life-quest/core/battleResultRecovery';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import { applyCloudCacheToMobileStores } from '../platform/cloudSeed';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { createBattleEngineState, type BattleActors } from '@life-quest/core/battle';
import RootLayout from '../../app/_layout';
import MapScreen from './MapScreen';
import { useMobileGameStore } from '../stores/useMobileGameStore';

const mocks = vi.hoisted(() => ({ route: 'map', retainMap: false, auth: vi.fn(), start: vi.fn(), resolve: vi.fn() }));
vi.mock('../platform/auth', () => ({ getBattleAuthState: mocks.auth, getGameAuthState: mocks.auth,
    startAuthSessionListener: () => () => {}, startMobileAuthLinkListener: () => () => {} }));
vi.mock('../platform/battleCloud', () => ({ startCloudBattleAttempt: mocks.start, resolveCloudBattleAttempt: mocks.resolve }));
const nativeDisk = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async (key: string) => nativeDisk.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { nativeDisk.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { nativeDisk.delete(key); }),
} }));
vi.mock('../stores/useMobileLoginBonusStore', () => ({ beginMobileLoginBonusCloudSession: vi.fn(), clearMobileLoginBonusCloudSession: vi.fn() }));
vi.mock('../platform/cloudMigration', () => ({ registerMobileCloudMigrationHooks: () => () => {} }));
vi.mock('../platform/pendingCompletionFlush', () => ({ registerPendingCompletionFlush: () => () => {} }));
vi.mock('../platform/notifications', () => ({ registerNotificationChecks: () => () => {} }));
vi.mock('../platform/loginBonusCheck', () => ({ registerLoginBonusCheck: () => () => {} }));
vi.mock('../platform/cloudSync', () => ({ registerMobileCloudSyncHooks: () => () => {} }));
vi.mock('../platform/cloudOutbox', () => ({ registerMobileOutboxHooks: () => () => {} }));
vi.mock('../platform/canonicalSync', async (importOriginal) => ({
    ...await importOriginal<typeof import('../platform/canonicalSync')>(),
    startMobileCanonicalSync: () => ({ stop() {} }),
}));
vi.mock('../stores/rewardSync', () => ({ startRewardSync: () => () => {} }));
vi.mock('../stores/statsLogSeed', () => ({ startStatsLogSeed: () => () => {} }));
vi.mock('../components/LoginBonusOverlay', () => ({ LoginBonusOverlay: () => null }));
vi.mock('../components/ChestOpeningOverlay', () => ({ ChestOpeningOverlay: () => null }));
vi.mock('../components/CloudSessionRecoveryGate', () => ({ CloudSessionRecoveryGate: () => null }));
vi.mock('../components/InventoryOperationsProvider', () => ({ InventoryOperationsProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('expo-router', () => ({
    usePathname: () => mocks.route === 'map' ? '/map' : '/tasks',
    Stack: Object.assign(() => mocks.retainMap
        ? createElement('div', {}, createElement('div', { hidden: mocks.route !== 'map' }, createElement(MapScreen)), mocks.route === 'map' ? null : createElement('div', {}, 'tasks-route'))
        : mocks.route === 'map' ? createElement(MapScreen) : createElement('div', {}, 'tasks-route'), { Screen: () => null }),
    useFocusEffect: (callback: () => void | (() => void)) => useEffect(() => mocks.route === 'map' ? callback() : undefined, [callback, mocks.route]),
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
function terminal(id: string | null = 'attempt-a', outcome: 'victory' | 'defeat' = 'victory', mode: 'cloud' | 'local' = 'cloud') {
    return { stage: 1, actors, state: { ...createBattleEngineState(actors), outcome },
        actions: [{ type: 'attack' as const }], battleAttemptId: id, rewardMode: mode };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { resolve, reject, promise }; }
const response = (outcome: 'victory' | 'defeat' = 'victory', granted = outcome === 'victory') => ({ outcome, granted });
let root: Root; let host: HTMLDivElement; let mounted: boolean;
function button(label: string) { return [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label); }
async function click(label: string) { const target = button(label); expect(target).toBeTruthy(); await act(async () => target!.click()); }
async function render(route = 'map') { const first = !mounted; mocks.route = route; mounted = true;
    await act(async () => root.render(createElement(StrictMode, {}, createElement(RootLayout))));
    if (first) await act(async () => notifyLogin('a')); // Real auth store registration sees the restored owner.
}
const retryLabel = 'バトル結果の同期を再送する';
beforeEach(async () => {
    nativeDisk.clear(); resetAuthLifecycleHooks(); await notifyLogin('a'); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.clearAllMocks(); mocks.retainMap = false;
    mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'a' }); mocks.resolve.mockResolvedValue(response()); mocks.start.mockResolvedValue(null);
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, activeBattle: terminal(),
        lastLevelUp: null, battleProgress: { battleUnlocked: true, currentStage: 1, maxClearedStage: 0 } });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = false;
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); host.remove(); resetAuthLifecycleHooks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Mobile battle results through real root/map and navigation/native stubs', () => {
    it('keeps a failed result and reuses its key/actions only after explicit retry on return', async () => {
        mocks.resolve.mockRejectedValueOnce(new TypeError('response lost')); await render(); expect(button(retryLabel)).toBeTruthy();
        const sent = structuredClone(mocks.resolve.mock.calls[0][1]);
        await render('tasks'); await render(); expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(button('次へ')?.disabled).toBe(true);
        expect(button(retryLabel)).toBeTruthy(); await click(retryLabel); expect(mocks.resolve).toHaveBeenCalledTimes(2);
        expect(mocks.resolve.mock.calls.map(([id]) => id)).toEqual(['attempt-a', 'attempt-a']);
        expect(mocks.resolve.mock.calls[0][2].idempotencyKey).toBe(mocks.resolve.mock.calls[1][2].idempotencyKey);
        expect(mocks.resolve.mock.calls[1][1]).toEqual(sent); expect(useMobileGameStore.getState().character.totalXp).toBe(5);
        expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBeNull(); expect(button('次へ')?.disabled).toBe(false);
    });
    it('offers a saved result after a full root remount and native disk rehydrate', async () => {
        mocks.resolve.mockRejectedValueOnce(new TypeError('response lost'));
        await render();
        const resultKey = battleResultRecoveryKey('a');
        expect(nativeDisk.has(resultKey)).toBe(true);
        await act(async () => root.unmount());
        mounted = false;
        const raw = nativeDisk.get('quest-board-game')!;
        useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), activeBattle: null, hasHydrated: false });
        nativeDisk.set('quest-board-game', raw);
        await useMobileGameStore.persist.rehydrate();
        expect(useMobileGameStore.getState().activeBattle).toBeNull();
        root = createRoot(host);
        await render();
        expect(mocks.resolve).toHaveBeenCalledTimes(1);
        await click('保存した戦闘結果を再送する');
        expect(mocks.resolve).toHaveBeenCalledTimes(2);
        const [first, second] = mocks.resolve.mock.calls;
        expect(second.slice(0, 2)).toEqual(first.slice(0, 2));
        expect(second[2]).toMatchObject({ expectedUserId: 'a', idempotencyKey: first[2].idempotencyKey });
        expect(nativeDisk.has(resultKey)).toBe(false);
        expect(button('保存した戦闘結果を再送する')).toBeUndefined();
        expect(useMobileGameStore.getState().character.totalXp).toBe(0);
    });
    it('retries the original action snapshot even if the same terminal attempt changes while away', async () => {
        mocks.resolve.mockRejectedValueOnce(new TypeError('lost')); await render(); await render('tasks');
        await act(async () => useMobileGameStore.setState((game) => ({ activeBattle: { ...game.activeBattle!, actions: [{ type: 'skill', skillId: 'guard_stance' }] } })));
        await render(); expect(mocks.resolve).toHaveBeenCalledTimes(1); await click(retryLabel);
        expect(mocks.resolve.mock.calls[1][1]).toEqual([{ type: 'attack' }]);
        expect(mocks.resolve.mock.calls[0][2].idempotencyKey).toBe(mocks.resolve.mock.calls[1][2].idempotencyKey);
    });
    it('keeps an initiated failure in a retained map tab without automatic resend', async () => {
        mocks.retainMap = true; mocks.resolve.mockRejectedValueOnce(new TypeError('lost')); await render(); await render('tasks'); await render();
        expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(button(retryLabel)).toBeTruthy(); await click(retryLabel);
        expect(mocks.resolve.mock.calls[0][2].idempotencyKey).toBe(mocks.resolve.mock.calls[1][2].idempotencyKey);
    });
    it('keeps a failure received while away without resending on remount', async () => {
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise); await render(); await render('tasks');
        await act(async () => pending.reject(new TypeError('lost while away'))); expect(host.textContent).toContain('tasks-route');
        await render(); expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(button(retryLabel)).toBeTruthy(); await click(retryLabel);
        expect(mocks.resolve.mock.calls[0][2].idempotencyKey).toBe(mocks.resolve.mock.calls[1][2].idempotencyKey);
    });
    it('keeps in-flight exclusivity and applies a delayed result once while away without navigation', async () => {
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise); await render(); await render('tasks'); await render();
        expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(button('次へ')?.disabled).toBe(true); expect(button('マップへ')?.disabled).toBe(true);
        await click('次へ'); expect(mocks.start).not.toHaveBeenCalled(); await render('tasks'); await act(async () => pending.resolve(response()));
        expect(host.textContent).toContain('tasks-route'); expect(useMobileGameStore.getState().character.totalXp).toBe(5);
        expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBeNull(); expect(useMobileGameStore.getState().battleProgress.maxClearedStage).toBe(1);
        await render(); expect(host.textContent).toContain('5 XP を獲得！'); expect(button('次へ')?.disabled).toBe(false); expect(mocks.resolve).toHaveBeenCalledTimes(1);
    });
    it('keeps defeat retryable after remount without granting XP', async () => {
        useMobileGameStore.setState({ activeBattle: terminal('defeat-a', 'defeat') });
        mocks.resolve.mockRejectedValueOnce(new TypeError('lost')).mockResolvedValue(response('defeat')); await render(); await render('tasks'); await render();
        expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(button('リトライ')?.disabled).toBe(true); await click(retryLabel);
        expect(mocks.resolve.mock.calls[0][2].idempotencyKey).toBe(mocks.resolve.mock.calls[1][2].idempotencyKey);
        expect(useMobileGameStore.getState().character.totalXp).toBe(0); expect(button('リトライ')?.disabled).toBe(false);
    });
    it('preserves already-granted feedback and does not add XP when granted is false', async () => {
        mocks.resolve.mockResolvedValue(response('victory', false)); await render(); await render('tasks'); await render();
        expect(host.textContent).toContain('既に付与済み'); expect(useMobileGameStore.getState().character.totalXp).toBe(0);
        expect(useMobileGameStore.getState().battleProgress.maxClearedStage).toBe(1); expect(mocks.resolve).toHaveBeenCalledTimes(1);
    });
    it.each(['local', 'settled-cloud'])('does not send %s results on entry', async (mode) => {
        useMobileGameStore.setState({ activeBattle: terminal(null, 'victory', mode === 'local' ? 'local' : 'cloud') }); await render();
        expect(mocks.resolve).not.toHaveBeenCalled(); expect(button('次へ')?.disabled).toBe(false);
    });
    it.each([false, true])('waits for map entry to start a new result while away (previously mounted: %s)', async (visited) => {
        useMobileGameStore.setState({ activeBattle: null }); if (visited) await render(); await render('tasks');
        await act(async () => useMobileGameStore.setState({ activeBattle: terminal('new-away') })); expect(mocks.resolve).not.toHaveBeenCalled();
        await render(); expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(mocks.resolve.mock.calls[0][0]).toBe('new-away');
    });
    it('does not auto-send a new result from a retained but blurred map tab', async () => {
        mocks.retainMap = true; useMobileGameStore.setState({ activeBattle: null }); await render(); await render('tasks');
        await act(async () => useMobileGameStore.setState({ activeBattle: terminal('blurred') })); expect(mocks.resolve).not.toHaveBeenCalled();
        await render(); expect(mocks.resolve).toHaveBeenCalledTimes(1);
    });
    it('does not let old A responses or finally release B’s pending result', async () => {
        const old = deferred<unknown>(); const current = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        await render(); await render('tasks'); await act(async () => { mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b');
            useMobileGameStore.setState({ activeBattle: terminal('attempt-b') }); });
        await render(); expect(mocks.resolve.mock.calls[1][2].expectedUserId).toBe('b');
        expect(mocks.resolve.mock.calls[0][2].idempotencyKey).not.toBe(mocks.resolve.mock.calls[1][2].idempotencyKey);
        await act(async () => old.resolve(response())); expect(useMobileGameStore.getState().character.totalXp).toBe(0);
        expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe('attempt-b'); expect(button('次へ')?.disabled).toBe(true);
        await render('tasks'); await act(async () => current.resolve(response())); expect(useMobileGameStore.getState().character.totalXp).toBe(5);
    });
    it('does not rebind the old A attempt before asynchronous auth store cleanup', async () => {
        const release = deferred<void>(); let changing: Promise<void> | undefined; const unregister = registerAuthLifecycleHooks({ onLogin: (owner) => owner === 'b' ? release.promise : undefined });
        try {
            mocks.resolve.mockRejectedValue(new TypeError('lost')); await render(); await render('tasks');
            await act(async () => { mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); changing = notifyLogin('b'); });
            await render(); expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(button(retryLabel)).toBeUndefined();
            await act(async () => { release.resolve(); await changing; }); expect(useMobileGameStore.getState().character.totalXp).toBe(0);
        } finally { await act(async () => { release.resolve(); await changing; }); unregister(); }
    });
    it('ignores delayed results after the entire RootLayout unmounts', async () => {
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise); await render();
        await act(async () => root.unmount()); mounted = false; await act(async () => pending.resolve(response()));
        expect(mocks.resolve.mock.calls[0][2].isActive()).toBe(false); expect(useMobileGameStore.getState().character.totalXp).toBe(0);
    });
    it.each([false, true])('does not apply again after real cloud seed while away (retained map: %s)', async (retained) => {
        mocks.retainMap = retained;
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise); await render(); await render('tasks');
        const cache = applyPullBatchToCache(createEmptyCloudCache(), { next_cursor: 10, has_more: false,
            characters: [{ user_id: 'a', total_xp: 5, max_cleared_stage: 1, battle_unlocked: true, version: 10 }],
            battle_attempts: [{ id: 'attempt-a', user_id: 'a', stage: 1, status: 'resolved', outcome: 'victory', version: 10 }],
        });
        await act(async () => { expect(applyCloudCacheToMobileStores(cache)).toBe(true); pending.resolve(response()); });
        expect(useMobileGameStore.getState().character.totalXp).toBe(5); await render(); expect(mocks.resolve).toHaveBeenCalledTimes(1);
    });
    it('rejects a stale response after another terminal attempt replaces it while away', async () => {
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise); await render(); await render('tasks');
        await act(async () => useMobileGameStore.setState({ activeBattle: terminal('newer') }));
        await act(async () => pending.resolve(response())); expect(useMobileGameStore.getState().character.totalXp).toBe(0);
        expect(mocks.resolve).toHaveBeenCalledTimes(1); await render(); expect(mocks.resolve.mock.calls[1][0]).toBe('newer');
    });
    it('keeps an initiated result through same-owner notifications while away', async () => {
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise); await render(); await render('tasks');
        await act(async () => { await notifyLogin('a'); pending.resolve(response()); });
        expect(useMobileGameStore.getState().character.totalXp).toBe(5); expect(mocks.resolve).toHaveBeenCalledTimes(1);
    });
    it('submits a normal cloud victory once after the timed attack and grants XP only after resolve', async () => {
        const enemy = { ...actors, enemy: { ...actors.enemy, maxHp: 1 } };
        useMobileGameStore.setState({ activeBattle: { stage: 1, actors: enemy, state: createBattleEngineState(enemy), actions: [], battleAttemptId: 'fight', rewardMode: 'cloud' } });
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise); await render(); expect(mocks.resolve).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(mocks.resolve).toHaveBeenCalledTimes(1);
        expect(mocks.resolve.mock.calls[0][1]).toEqual([{ type: 'attack' }]); expect(useMobileGameStore.getState().character.totalXp).toBe(0);
        await render('tasks'); await act(async () => pending.resolve(response())); expect(useMobileGameStore.getState().character.totalXp).toBe(5);
    });
    it('does not apply old A results after logout and A login while away', async () => {
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise); await render(); await render('tasks');
        await act(async () => { await notifyLogout(); await notifyLogin('a'); pending.resolve(response()); });
        await render(); expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(useMobileGameStore.getState().character.totalXp).toBe(0);
    });
});
