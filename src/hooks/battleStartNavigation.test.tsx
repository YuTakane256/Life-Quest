import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNavigate } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { sanitizeGameStoreState, useGameStore } from '../stores/useGameStore';
import { useBattleHistoryStore } from '../stores/useBattleHistoryStore';
import App from '../App';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), resolve: vi.fn(), start: vi.fn() }));
vi.mock('../platform/auth', () => ({ getGameAuthState: mocks.auth, getBattleAuthState: mocks.auth }));
vi.mock('../platform/gameCloud', () => ({ resolveCloudBattleAttempt: mocks.resolve, startCloudBattleAttempt: mocks.start,
    openCloudChest: vi.fn(), synthesizeCloudItems: vi.fn() }));
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: vi.fn(), isWebCloudOutboxActive: () => false }));
vi.mock('../utils/notifications', () => ({ runNotificationChecks: vi.fn(), cancelNotificationChecks: vi.fn() }));
vi.mock('../stores/useLoginBonusStore', () => ({ useLoginBonusStore: { getState: () => ({ checkDailyLogin() {} }) } }));
vi.mock('../pages/TasksPage', () => ({ TasksPage: () => createElement('div', {}, 'tasks-route') }));
vi.mock('../components/layout/BottomNav', () => ({ BottomNav: () => {
    const navigate = useNavigate();
    return createElement('nav', {}, ...['tasks', 'map'].map((path) => createElement('button',
        { key: path, onClick: () => navigate('/' + path) }, 'go-' + path)));
} }));
vi.mock('../components/ui/ThemeController', () => ({ ThemeController: () => null }));
vi.mock('../components/ui/LevelUpOverlay', () => ({ LevelUpOverlay: () => null }));
vi.mock('../components/ui/LoginBonusOverlay', () => ({ LoginBonusOverlay: () => null }));
vi.mock('../components/ui/ChestOpeningOverlay', () => ({ ChestOpeningOverlay: () => null }));
vi.mock('../components/ui/CompletionRewardNotice', () => ({ CompletionRewardNotice: () => null }));

let root: Root; let host: HTMLDivElement; let mounted: boolean;
const initial = useGameStore.getInitialState();
const terminal = (id = 'attempt-a', status: 'victory' | 'defeat' = 'victory') => ({ ...initial.battle,
    status, currentStage: 1, battleUnlocked: true, rewardMode: 'cloud' as const, battleAttemptId: id,
    playerHp: 50, playerSnapshot: { name: 'hero', level: 1, attack: 10, defense: 5, maxHp: 50 },
    enemy: { stage: 1, name: 'slime', hp: 0, maxHp: 10, attack: 1, defense: 1, xpReward: 5 },
    actions: [{ type: 'attack' as const }],
});
const idle = () => ({ ...initial.battle, battleUnlocked: true });
const attempt = (id = 'started') => ({ battleAttemptId: id, actors: {
    player: { attack: 10, defense: 5, maxHp: 50 }, playerLevel: 1, playerName: 'hero',
    enemy: { stage: 1, name: 'slime', maxHp: 10, attack: 1, defense: 1, xpReward: 5 },
} });
function button(text: string) { return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!; }
async function click(text: string) { const target = button(text); expect(target).toBeTruthy(); await act(async () => target.click()); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
const response = (outcome: 'victory' | 'defeat' = 'victory') => ({ outcome, granted: outcome === 'victory' });
async function render(path = '/map', strict = false) {
    history.replaceState({}, '', path); mounted = true;
    await act(async () => root.render(strict ? createElement(StrictMode, null, createElement(App)) : createElement(App)));
}
beforeEach(async () => {
    await import('../pages/MapBattlePage');
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_: string, work: () => unknown) => Promise.resolve(work()) } });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetAuthLifecycleHooks(); await notifyLogin('a'); localStorage.clear();
    vi.clearAllMocks(); mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'a' }); mocks.resolve.mockResolvedValue(response()); mocks.start.mockResolvedValue(attempt());
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
    useGameStore.setState({ ...initial, battle: idle(), character: { ...initial.character, totalXp: 0 } });
    useBattleHistoryStore.setState({ history: [] });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = false;
});
afterEach(async () => {
    if (mounted) await act(async () => root.unmount()); Reflect.deleteProperty(navigator, 'locks'); host.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals();
    useGameStore.setState(initial); useBattleHistoryStore.setState({ history: [] }); history.replaceState({}, '', '/');
});

describe('Web battle starts across actual routes', () => {
    it('retains the failed stage/key after route changes and retries only on explicit request', async () => {
        mocks.start.mockRejectedValueOnce(new TypeError('response lost')); await render();
        await click('スタート'); expect(button('再試行')).toBeTruthy();
        await click('go-tasks'); await click('go-map'); expect(button('再試行')).toBeTruthy();
        expect(mocks.start).toHaveBeenCalledTimes(1); await click('再試行');
        expect(mocks.start).toHaveBeenCalledTimes(2); expect(mocks.start.mock.calls.map(([stage]) => stage)).toEqual([1, 1]);
        expect(mocks.start.mock.calls[0][1]).toBe(mocks.start.mock.calls[1][1]);
        expect(useGameStore.getState().battle).toMatchObject({ status: 'fighting', battleAttemptId: 'started', currentStage: 1, rewardMode: 'cloud' });
        expect(useGameStore.getState().character.totalXp).toBe(0); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('keeps starts exclusive after returning and applies a delayed start while away without navigation or attacks', async () => {
        const pending = deferred<unknown>(); mocks.start.mockReturnValueOnce(pending.promise); await render();
        await click('スタート'); await click('go-tasks'); await click('go-map');
        expect(button('スタート').disabled).toBe(true); await click('スタート'); expect(mocks.start).toHaveBeenCalledTimes(1);
        await click('go-tasks'); await act(async () => pending.resolve(attempt()));
        expect(location.pathname).toBe('/tasks'); expect(useGameStore.getState().battle).toMatchObject({ status: 'fighting', battleAttemptId: 'started', actions: [], logs: [] });
        expect(useGameStore.getState().character.totalXp).toBe(0); expect(useBattleHistoryStore.getState().history).toEqual([]);
        await click('go-map'); expect(host.textContent).toContain('ステージ 1: slime'); expect(mocks.start).toHaveBeenCalledTimes(1);
    });
    it('retains a failed next-stage request after navigation without repeating progress updates', async () => {
        useGameStore.setState({ battle: { ...terminal(), battleAttemptId: null, maxClearedStage: 1 } });
        mocks.start.mockRejectedValueOnce(new TypeError('lost')); await render(); await click('次へ');
        await click('go-tasks'); await click('go-map'); expect(button('再試行')).toBeTruthy(); await click('再試行');
        expect(mocks.start.mock.calls.map(([stage]) => stage)).toEqual([2, 2]);
        expect(mocks.start.mock.calls[0][1]).toBe(mocks.start.mock.calls[1][1]);
        expect(useGameStore.getState().battle).toMatchObject({ status: 'fighting', currentStage: 2, maxClearedStage: 1 });
        expect(mocks.resolve).not.toHaveBeenCalled(); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('starts the next local stage without advancing progress or granting the previous reward again', async () => {
        await notifyLogout(); mocks.auth.mockResolvedValue({ kind: 'anonymous' });
        useGameStore.setState({ battle: { ...terminal(), rewardMode: 'local', battleAttemptId: null, maxClearedStage: 1 },
            character: { ...initial.character, totalXp: 5 } });
        await render(); await click('次へ');
        expect(useGameStore.getState().battle).toMatchObject({ status: 'fighting', currentStage: 2, maxClearedStage: 1, rewardMode: 'local' });
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toEqual([]);
        expect(mocks.start).not.toHaveBeenCalled();
    });
    it('replays the final cleared stage without advancing beyond it', async () => {
        useGameStore.setState({ battle: { ...terminal(), currentStage: 40, maxClearedStage: 40, battleAttemptId: null } });
        await render(); await click('再挑戦');
        expect(mocks.start.mock.calls[0][0]).toBe(40);
        expect(useGameStore.getState().battle).toMatchObject({ status: 'fighting', currentStage: 40, maxClearedStage: 40 });
        expect(useGameStore.getState().character.totalXp).toBe(0); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('starts the next stage from a supported legacy local victory with unrecorded progress', async () => {
        await notifyLogout(); mocks.auth.mockResolvedValue({ kind: 'anonymous' });
        const restored = sanitizeGameStoreState({ battle: { ...terminal(), rewardMode: 'local', battleAttemptId: null, maxClearedStage: 0 },
            character: { ...initial.character, totalXp: 5 } });
        expect(restored.battle).toMatchObject({ status: 'victory', currentStage: 1, maxClearedStage: 0, rewardMode: 'local' });
        useGameStore.setState(restored);
        await render(); await click('次へ');
        expect(useGameStore.getState().battle).toMatchObject({ status: 'fighting', currentStage: 2, maxClearedStage: 1, rewardMode: 'local' });
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toEqual([]);
        expect(mocks.start).not.toHaveBeenCalled();
    });
    it('does not apply a delayed A start or release B starting state after switching accounts while away', async () => {
        const old = deferred<unknown>(); const current = deferred<unknown>(); mocks.start.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        await render(); await click('スタート'); await click('go-tasks');
        await act(async () => { mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b'); useGameStore.setState({ battle: idle() }); });
        await click('go-map'); await click('スタート'); expect(mocks.start.mock.calls[1][2]).toBe('b');
        await act(async () => old.resolve(attempt('old-a')));
        expect(useGameStore.getState().battle.status).toBe('idle'); expect(button('スタート').disabled).toBe(true);
        await act(async () => current.resolve(attempt('new-b')));
        expect(useGameStore.getState().battle.battleAttemptId).toBe('new-b');
        expect(mocks.start.mock.calls[0][1]).not.toBe(mocks.start.mock.calls[1][1]);
    });
    it('clears old retry identity after logout and uses a fresh B operation', async () => {
        mocks.start.mockRejectedValueOnce(new TypeError('lost')); await render(); await click('スタート'); await click('go-tasks');
        await act(async () => { await notifyLogout(); mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b'); useGameStore.setState({ battle: idle() }); });
        await click('go-map'); expect(button('再試行')).toBeUndefined(); await click('スタート');
        expect(mocks.start.mock.calls[1][2]).toBe('b'); expect(mocks.start.mock.calls[0][1]).not.toBe(mocks.start.mock.calls[1][1]);
    });
    it('discards a start after the whole App unmounts', async () => {
        const pending = deferred<unknown>(); mocks.start.mockReturnValueOnce(pending.promise); await render(); await click('スタート');
        await act(async () => root.unmount()); mounted = false; await act(async () => pending.resolve(attempt()));
        expect(mocks.start.mock.calls[0][3].isActive()).toBe(false); expect(useGameStore.getState().battle.status).toBe('idle');
        expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('discards a response after its source battle changes, then permits a fresh request', async () => {
        const pending = deferred<unknown>(); mocks.start.mockReturnValueOnce(pending.promise); await render(); await click('スタート'); await click('go-tasks');
        await act(async () => { useGameStore.getState().resetBattle(); pending.resolve(attempt('stale')); });
        expect(useGameStore.getState().battle.status).toBe('idle'); await click('go-map'); expect(button('再試行')).toBeUndefined();
        await click('スタート'); expect(useGameStore.getState().battle.battleAttemptId).toBe('started'); expect(mocks.start).toHaveBeenCalledTimes(2);
    });
    it('preserves anonymous local starts and makes no auth/start call until an explicit start in StrictMode', async () => {
        await act(async () => { await notifyLogout(); mocks.auth.mockResolvedValue({ kind: 'anonymous' }); });
        await render('/tasks', true); expect(mocks.auth).not.toHaveBeenCalled(); await click('go-map'); expect(mocks.auth).not.toHaveBeenCalled();
        await click('スタート'); expect(mocks.start).not.toHaveBeenCalled();
        expect(useGameStore.getState().battle).toMatchObject({ status: 'fighting', rewardMode: 'local', battleAttemptId: null });
        expect(useGameStore.getState().character.totalXp).toBe(0);
    });
});
