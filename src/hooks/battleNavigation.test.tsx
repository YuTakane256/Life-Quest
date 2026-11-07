import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNavigate } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { applyCloudCacheToWebStores } from '../platform/cloudSync';
import { battleResultRecoveryKey } from '@life-quest/core/battleResultRecovery';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from '../platform/completionRewards';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { useGameStore } from '../stores/useGameStore';
import { useBattleHistoryStore } from '../stores/useBattleHistoryStore';
import App from '../App';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), resolve: vi.fn(), start: vi.fn() }));
vi.mock('../platform/auth', () => ({ getGameAuthState: mocks.auth, getBattleAuthState: mocks.auth }));
vi.mock('../platform/gameCloud', () => ({ resolveCloudBattleAttempt: mocks.resolve, startCloudBattleAttempt: mocks.start,
    openCloudChest: vi.fn(), synthesizeCloudItems: vi.fn() }));
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: vi.fn(), isWebCloudOutboxActive: () => false }));
vi.mock('../utils/notifications', () => ({ runNotificationChecks: vi.fn(), cancelNotificationChecks: vi.fn() }));
vi.mock('../stores/useLoginBonusStore', () => ({ requestLoginBonusRecheck: vi.fn(), useLoginBonusStore: { getState: () => ({ checkDailyLogin() {} }) } }));
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
function button(text: string) { return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!; }
async function click(text: string) { const target = button(text); expect(target).toBeTruthy(); await act(async () => target.click()); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
function resolvedCache(outcome: 'victory' | 'defeat' = 'victory') {
    return applyPullBatchToCache(createEmptyCloudCache(), { next_cursor: 10, has_more: false,
        characters: [{ user_id: 'a', total_xp: outcome === 'victory' ? 5 : 0, current_stage: 4, max_cleared_stage: 3, battle_unlocked: true, version: 10 }],
        battle_attempts: [{ id: 'attempt-a', user_id: 'a', stage: 1, status: 'resolved', outcome, version: 10 }],
    });
}
const response = (outcome: 'victory' | 'defeat' = 'victory') => ({ outcome, granted: outcome === 'victory' });
async function render(path = '/map', strict = false) {
    history.replaceState({}, '', path); mounted = true;
    await act(async () => root.render(strict ? createElement(StrictMode, null, createElement(App)) : createElement(App)));
}
beforeEach(async () => {
    await flushCompletionRewardWrites(); setGameRewardAuthorityState('authenticated');
    await import('../pages/MapBattlePage');
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_: string, work: () => unknown) => Promise.resolve(work()) } });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetAuthLifecycleHooks(); await notifyLogin('a'); localStorage.clear();
    vi.clearAllMocks(); mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'a' }); mocks.resolve.mockResolvedValue(response());
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
    useGameStore.setState({ ...initial, battle: terminal(), character: { ...initial.character, totalXp: 0 } });
    useBattleHistoryStore.setState({ history: [] });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = false;
});
afterEach(async () => {
    if (mounted) await act(async () => root.unmount()); Reflect.deleteProperty(navigator, 'locks'); host.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals();
    useGameStore.setState(initial); useBattleHistoryStore.setState({ history: [] }); await flushCompletionRewardWrites(); localStorage.clear();
    setGameRewardAuthorityState('anonymous'); history.replaceState({}, '', '/');
});

describe('Web battle results across actual routes', () => {
    it('preserves a failed result without implicit resends, and explicitly retries the same attempt/actions/key', async () => {
        mocks.resolve.mockRejectedValueOnce(new TypeError('response lost')); await render();
        expect(button('再送')).toBeTruthy();
        await click('go-tasks'); await click('go-map');
        expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(button('再送')).toBeTruthy();
        // The retry uses the captured action snapshot, even if a later update changes the store array.
        await act(async () => useGameStore.setState({ battle: { ...useGameStore.getState().battle, actions: [{ type: 'skill', skillId: 'changed' }] } }));
        await act(async () => { button('再送').click(); button('再送').click(); });
        expect(mocks.resolve).toHaveBeenCalledTimes(2);
        expect(mocks.resolve.mock.calls.map(([id, actions]) => [id, actions])).toEqual([
            ['attempt-a', [{ type: 'attack' }]], ['attempt-a', [{ type: 'attack' }]],
        ]);
        expect(mocks.resolve.mock.calls[0][2].idempotencyKey).toBe(mocks.resolve.mock.calls[1][2].idempotencyKey);
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toHaveLength(1);
        expect(button('次へ').disabled).toBe(false);
    });
    it('offers a saved result on the map after a full App remount and game rehydrate', async () => {
        mocks.resolve.mockRejectedValueOnce(new TypeError('response lost'));
        await render();
        const resultKey = battleResultRecoveryKey('a');
        expect(localStorage.getItem(resultKey)).toBeTruthy();
        await act(async () => root.unmount());
        mounted = false;
        await flushCompletionRewardWrites();
        const raw = localStorage.getItem('quest-board-game')!;
        withoutCompletionRewardPersistence(() => useGameStore.setState(initial));
        localStorage.setItem('quest-board-game', raw);
        await useGameStore.persist.rehydrate();
        expect(useGameStore.getState().battle.status).toBe('idle');
        root = createRoot(host);
        await render();
        expect(mocks.resolve).toHaveBeenCalledTimes(1);
        await click('保存した戦闘結果を再送する');
        expect(mocks.resolve).toHaveBeenCalledTimes(2);
        const [first, second] = mocks.resolve.mock.calls;
        expect(second.slice(0, 2)).toEqual(first.slice(0, 2));
        expect(second[2]).toMatchObject({ expectedUserId: 'a', idempotencyKey: first[2].idempotencyKey });
        expect(localStorage.getItem(resultKey)).toBeNull();
        expect(button('保存した戦闘結果を再送する')).toBeUndefined();
        expect(useGameStore.getState().character.totalXp).toBe(0);
        await act(async () => { applyCloudCacheToWebStores(resolvedCache()); });
        expect(useGameStore.getState().character.totalXp).toBe(5);
    });
    it('does not send the result until durable storage succeeds', async () => {
        const original = Storage.prototype.setItem;
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
            if (key === battleResultRecoveryKey('a')) throw new Error('storage unavailable');
            original.call(this, key, value);
        });
        try {
            await render();
            expect(button('再送')).toBeTruthy();
            expect(mocks.resolve).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
        await click('再送');
        expect(mocks.resolve).toHaveBeenCalledTimes(1);
    });
    it('retains the in-flight lock, applies the result once while away, and leaves the current route unchanged', async () => {
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise); await render();
        await click('go-tasks'); await click('go-map');
        expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(button('次へ').disabled).toBe(true); expect(button('マップへ').disabled).toBe(true);
        await click('go-tasks'); await act(async () => pending.resolve(response()));
        expect(location.pathname).toBe('/tasks'); expect(useGameStore.getState().battle.battleAttemptId).toBeNull();
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toHaveLength(1);
        await click('go-map'); expect(host.textContent).toContain('5 XP を獲得！'); expect(button('次へ').disabled).toBe(false);
        expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(mocks.start).not.toHaveBeenCalled();
    });
    it('keeps a failed defeat retryable after navigation without granting XP', async () => {
        useGameStore.setState({ battle: terminal('defeat-a', 'defeat') });
        mocks.resolve.mockRejectedValueOnce(new TypeError('lost')).mockResolvedValue(response('defeat')); await render();
        await click('go-tasks'); await click('go-map'); expect(mocks.resolve).toHaveBeenCalledTimes(1);
        expect(button('リトライ').disabled).toBe(true); await click('再送');
        expect(mocks.resolve.mock.calls[0][2].idempotencyKey).toBe(mocks.resolve.mock.calls[1][2].idempotencyKey);
        expect(useGameStore.getState().character.totalXp).toBe(0); expect(useBattleHistoryStore.getState().history).toHaveLength(1);
        expect(button('リトライ').disabled).toBe(false);
    });
    it('does not mix a late A result or unlock the new B request after account switching while away', async () => {
        const old = deferred<unknown>(); const current = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        await render(); await click('go-tasks');
        await act(async () => { mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b');
            useGameStore.setState({ battle: terminal('attempt-b') }); });
        await click('go-map'); expect(mocks.resolve.mock.calls[1][2].expectedUserId).toBe('b');
        expect(mocks.resolve.mock.calls[0][2].idempotencyKey).not.toBe(mocks.resolve.mock.calls[1][2].idempotencyKey);
        await act(async () => old.resolve(response()));
        expect(useGameStore.getState().character.totalXp).toBe(0); expect(useBattleHistoryStore.getState().history).toEqual([]);
        expect(button('次へ').disabled).toBe(true); expect(useGameStore.getState().battle.battleAttemptId).toBe('attempt-b');
        await act(async () => current.resolve(response()));
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toHaveLength(1);
    });
    it('does not rebind the old A attempt to B if auth notification precedes store cleanup', async () => {
        mocks.resolve.mockRejectedValue(new TypeError('lost')); await render(); await click('go-tasks');
        await act(async () => { await notifyLogout(); mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b'); });
        await click('go-map'); expect(button('再送')).toBeUndefined(); expect(mocks.resolve).toHaveBeenCalledTimes(1);
        expect(useGameStore.getState().character.totalXp).toBe(0); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('does not apply a response after the entire App unmounts', async () => {
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise); await render();
        await act(async () => root.unmount()); mounted = false; await act(async () => pending.resolve(response()));
        expect(mocks.resolve.mock.calls[0][2].isActive()).toBe(false);
        expect(useGameStore.getState().character.totalXp).toBe(0); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it.each([false, true])('does not duplicate XP or history when real cloud seed precedes the response (away: %s)', async (away) => {
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise); await render(); if (away) await click('go-tasks');
        await act(async () => { expect(applyCloudCacheToWebStores(resolvedCache())).toBe(true); });
        await act(async () => pending.resolve(response())); if (away) await click('go-map');
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useGameStore.getState().battle.currentStage).toBe(1);
        expect(useBattleHistoryStore.getState().history).toHaveLength(1); expect(useBattleHistoryStore.getState().history[0]).toMatchObject({ stage: 1, outcome: 'victory', xpEarned: 5 });
        expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(button('次へ').disabled).toBe(false);
    });
    it('settles a failed request from confirmed cloud seed without requiring another RPC', async () => {
        mocks.resolve.mockRejectedValueOnce(new TypeError('lost')); await render(); await click('go-tasks');
        await act(async () => { applyCloudCacheToWebStores(resolvedCache()); }); await click('go-map');
        expect(button('再送')).toBeUndefined(); expect(button('次へ').disabled).toBe(false); expect(mocks.resolve).toHaveBeenCalledTimes(1);
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toHaveLength(1);
    });
    it('does not duplicate history if the RPC arrives first and the same cloud result is pulled repeatedly', async () => {
        await render(); await act(async () => { applyCloudCacheToWebStores(resolvedCache()); applyCloudCacheToWebStores(resolvedCache()); });
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toHaveLength(1);
        expect(useGameStore.getState().battle.currentStage).toBe(1); expect(mocks.resolve).toHaveBeenCalledTimes(1);
    });
    it('settles a confirmed defeat before a delayed response and keeps one zero-XP history entry', async () => {
        const pending = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(pending.promise);
        useGameStore.setState({ battle: terminal('attempt-a', 'defeat') }); await render(); await click('go-tasks');
        await act(async () => { applyCloudCacheToWebStores(resolvedCache('defeat')); pending.resolve(response('defeat')); }); await click('go-map');
        expect(useGameStore.getState().character.totalXp).toBe(0); expect(useBattleHistoryStore.getState().history).toHaveLength(1);
        expect(useBattleHistoryStore.getState().history[0]).toMatchObject({ stage: 1, outcome: 'defeat', xpEarned: 0 }); expect(button('リトライ').disabled).toBe(false);
    });
    it.each(['/map/', '/MAP'])('resolves restored results on router-equivalent map URL %s', async (path) => {
        await render(path);
        expect(host.textContent).toContain('勝利！'); expect(mocks.resolve).toHaveBeenCalledTimes(1);
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toHaveLength(1);
        expect(button('次へ').disabled).toBe(false); expect(button('マップへ').disabled).toBe(false);
    });
    it('does not initiate resolution on unrelated startup routes, then resolves once on entering the map in StrictMode', async () => {
        await render('/tasks', true); expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
        await click('go-map'); expect(mocks.resolve).toHaveBeenCalledTimes(1);
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toHaveLength(1);
    });
});
