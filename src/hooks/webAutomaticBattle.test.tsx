import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from '../platform/completionRewards';
import { BATTLE_CONFIG } from '../config/gameConfig';
import { useGameStore } from '../stores/useGameStore';
import { useBattleHistoryStore } from '../stores/useBattleHistoryStore';
import { MapBattlePage } from '../pages/MapBattlePage';
import { registerWebAuthStoreHooks } from '../platform/authStores';

vi.mock('../hooks/useBattleStart', () => ({ useBattleStart: () => ({ isStarting: false, startError: null, startStage: vi.fn(), retry: vi.fn() }) }));
vi.mock('../hooks/useBattleResult', () => ({ useBattleResult: () => ({ resolveState: 'idle', granted: null, retry: vi.fn() }) }));
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: vi.fn(), isWebCloudOutboxActive: () => false }));
let root: Root; let host: HTMLDivElement; let mounted: boolean; let visibility: DocumentVisibilityState;
const initial = useGameStore.getInitialState(); const interval = BATTLE_CONFIG.TURN_INTERVAL_MS;
const player = () => ({ name: 'hero', level: 10, attack: 20, defense: 10, maxHp: 200 });
function start(id = 'attempt-a', enemyHp = 500) {
    useGameStore.getState().startCloudBattle(1, id, player(), { stage: 1, name: 'enemy', hp: enemyHp, maxHp: enemyHp, attack: 20, defense: 5, xpReward: 5 });
}
function battle() { return useGameStore.getState().battle; }
async function render() { mounted = true; await act(async () => root.render(createElement(StrictMode, null, createElement(MapBattlePage)))); }
async function advance(ms: number = interval) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function visible(value: DocumentVisibilityState) { act(() => { visibility = value; document.dispatchEvent(new Event('visibilitychange')); }); }
function queuedTick(): () => void {
    const callback = vi.mocked(window.setInterval).mock.calls.filter(([, ms]) => ms === interval).at(-1)![0];
    expect(typeof callback).toBe('function'); return callback as () => void;
}
beforeEach(async () => {
    await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); await notifyLogin('a');
    setGameRewardAuthorityState('authenticated'); localStorage.clear();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.spyOn(window, 'setInterval');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
    withoutCompletionRewardPersistence(() => useGameStore.setState({ ...initial, battle: { ...initial.battle, battleUnlocked: true } }));
    useBattleHistoryStore.setState({ history: [] });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = false;
});
afterEach(async () => {
    if (mounted) await act(async () => root.unmount()); host.remove(); await flushCompletionRewardWrites();
    withoutCompletionRewardPersistence(() => useGameStore.setState(initial)); useBattleHistoryStore.setState({ history: [] });
    resetAuthLifecycleHooks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('Web automatic battle lifecycle through the real map', () => {
    it('attacks exactly once per interval in StrictMode', async () => {
        start(); await render(); await advance(interval - 1); expect(battle().actions).toEqual([]);
        await advance(1); expect(battle().actions).toEqual([{ type: 'attack' }]); await advance(interval * 2); expect(battle().actions).toHaveLength(3);
    });
    it('pauses while hidden and resumes with a fresh interval without catching up', async () => {
        start(); await render(); await advance(500); visible('hidden'); await advance(5000); expect(battle().actions).toEqual([]);
        visible('visible'); await advance(interval - 1); expect(battle().actions).toEqual([]); await advance(1); expect(battle().actions).toHaveLength(1);
    });
    it('waits for visibility when initially hidden', async () => {
        visibility = 'hidden'; start(); await render(); await advance(5000); expect(battle().actions).toEqual([]);
        visible('visible'); await advance(); expect(battle().actions).toHaveLength(1);
    });
    it('does not restart the clock on duplicate visible events', async () => {
        start(); await render(); await advance(500); visible('visible'); await advance(500); expect(battle().actions).toHaveLength(1);
    });
    it('does not let a queued old tick attack after hidden/visible resumption', async () => {
        start(); await render(); const stale = queuedTick(); visible('hidden'); visible('visible');
        act(() => stale()); expect(battle().actions).toEqual([]); await advance(); expect(battle().actions).toHaveLength(1);
    });
    it('does not let a queued tick act after leaving the map', async () => {
        start(); await render(); const stale = queuedTick(); await act(async () => root.unmount()); mounted = false;
        act(() => stale()); expect(battle().actions).toEqual([]); await advance(5000); expect(battle().actions).toEqual([]);
    });
    it('does not let a queued tick from another fighting attempt act on the new battle', async () => {
        start(); await render(); const stale = queuedTick(); await act(async () => start('attempt-new'));
        act(() => stale()); expect(battle().battleAttemptId).toBe('attempt-new'); expect(battle().actions).toEqual([]);
        await advance(); expect(battle().actions).toHaveLength(1);
    });
    it('stops on account change and does not revive the old battle by toggling visibility', async () => {
        start(); await render(); const stale = queuedTick(); await act(async () => notifyLogin('b'));
        act(() => stale()); visible('hidden'); visible('visible'); await advance(5000); expect(battle().actions).toEqual([]);
        await act(async () => start('attempt-b')); await advance(); expect(battle().actions).toHaveLength(1);
    });
    it('does not resume an old A battle after logout and A login', async () => {
        start(); await render(); const stale = queuedTick(); await act(async () => { await notifyLogout(); await notifyLogin('a'); });
        act(() => stale()); visible('hidden'); visible('visible'); await advance(5000); expect(battle().actions).toEqual([]);
    });
    it('returns an anonymous local fight to the map on first login without discarding saved progress', async () => {
        await notifyLogout(); setGameRewardAuthorityState('anonymous');
        const unregister = registerWebAuthStoreHooks();
        try {
            useGameStore.setState({ character: { ...initial.character, totalXp: 20 }, gachaCount: 7 });
            useGameStore.getState().startBattle(1); await render(); const stale = queuedTick();
            await act(async () => { setGameRewardAuthorityState('authenticated'); await notifyLogin('new-owner'); });
            expect(battle().status).toBe('idle'); expect(host.textContent).toContain('最高到達');
            expect(useGameStore.getState().character.totalXp).toBe(20); expect(useGameStore.getState().gachaCount).toBe(7);
            act(() => stale()); visible('hidden'); visible('visible'); await advance(5000); expect(battle().actions).toEqual([]);
            await act(async () => start('new-owner-attempt')); await advance(); expect(battle().actions).toHaveLength(1);
            expect(useBattleHistoryStore.getState().history).toEqual([]);
        } finally { unregister(); }
    });
    it('does not revive an anonymous fight after leaving the map and logging in', async () => {
        await notifyLogout(); setGameRewardAuthorityState('anonymous'); const unregister = registerWebAuthStoreHooks();
        try {
            useGameStore.getState().startBattle(1); await render(); const stale = queuedTick();
            await act(async () => root.render(createElement('div', null, 'Tasks')));
            await act(async () => notifyLogin('new-owner'));
            await render(); act(() => stale()); await advance(5000);
            expect(battle().status).toBe('idle'); expect(battle().actions).toEqual([]); expect(host.textContent).toContain('最高到達');
            expect(useBattleHistoryStore.getState().history).toEqual([]);
        } finally { unregister(); }
    });
    it('does not clear a newer local battle installed before the old auth listener runs', async () => {
        await notifyLogout(); setGameRewardAuthorityState('anonymous');
        const unsubscribe = subscribeAuthSessionScope(() => useGameStore.getState().startBattle(1));
        try {
            useGameStore.getState().startBattle(1); await render(); const old = battle().playerSnapshot;
            await act(async () => notifyLogin('new-owner'));
            expect(battle().status).toBe('fighting'); expect(battle().playerSnapshot).not.toBe(old);
            await advance(); expect(battle().actions).toHaveLength(1);
        } finally { unsubscribe(); }
    });
    it('keeps the clock through same-owner auth notifications', async () => {
        start(); await render(); await advance(500); await act(async () => notifyLogin('a')); await advance(500); expect(battle().actions).toHaveLength(1);
    });
    it('keeps normal attack timing when a manual skill changes state', async () => {
        start(); await render(); await advance(interval - 100); await act(async () => { expect(useGameStore.getState().activateBattleSkill('guard_stance')).toBe(true); });
        expect(battle().actions).toHaveLength(1); await advance(100); expect(battle().actions.map((a) => a.type)).toEqual(['skill', 'attack']);
    });
    it('stops on victory without granting cloud rewards or replaying a queued action', async () => {
        start('victory', 1); await render(); const stale = queuedTick(); await advance(); expect(battle().status).toBe('victory');
        act(() => stale()); await advance(5000); expect(battle().actions).toHaveLength(1);
        expect(useGameStore.getState().character.totalXp).toBe(initial.character.totalXp); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('keeps local victory rewards, progress and history at one result', async () => {
        await notifyLogout(); setGameRewardAuthorityState('anonymous'); useGameStore.getState().startBattle(1);
        await render(); const stale = queuedTick(); await advance(interval * 10);
        expect(battle().status).toBe('victory'); expect(battle().maxClearedStage).toBe(1);
        expect(useGameStore.getState().character.totalXp).toBe(initial.character.totalXp + BATTLE_CONFIG.STAGES[0].xpReward);
        expect(useBattleHistoryStore.getState().history).toHaveLength(1);
        const actions = battle().actions; act(() => stale()); await advance(5000); expect(battle().actions).toBe(actions);
        expect(useBattleHistoryStore.getState().history).toHaveLength(1);
    });
    it('does not create an attack clock when idle', async () => {
        await render(); expect(vi.mocked(window.setInterval).mock.calls.filter(([, ms]) => ms === interval)).toEqual([]); await advance(5000); expect(battle().actions).toEqual([]);
    });
    it('also observes a hidden document before its visibility event arrives', async () => {
        start(); await render(); visibility = 'hidden'; await advance(); expect(battle().actions).toEqual([]);
        visible('visible'); await advance(interval - 1); expect(battle().actions).toEqual([]); await advance(1); expect(battle().actions).toHaveLength(1);
    });
});
