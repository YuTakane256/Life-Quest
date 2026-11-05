import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNavigate } from 'react-router-dom';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from '../platform/completionRewards';
import { BATTLE_CONFIG } from '../config/gameConfig';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { syncAnonymousGameFromStorage, useGameStore } from '../stores/useGameStore';
import { createEquipmentFromTemplate } from '@life-quest/core/equipment';
import { EQUIPMENT_POOL } from '@life-quest/core/rewards';
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
const stage = BATTLE_CONFIG.STAGES[0];
const fixture = (status: 'idle' | 'fighting' | 'victory' | 'defeat', mode: 'local' | 'cloud' = 'local') => ({
    character: { ...initial.character, totalXp: 5 }, debuff: initial.debuff, equipment: [createEquipmentFromTemplate('saved-item', EQUIPMENT_POOL.find((item) => item.id === 'wooden_sword')!)], gachaCount: 7,
    chestQueue: [{ id: 'saved-chest', label: 'Saved chest', chestType: 'wood', opened: false, equipment: null, origin: 'local' }],
    completionRewardScope: 'anonymous', completionRewardKeys: ['task:saved-reward'],
    battle: { ...initial.battle, status, currentStage: 1, maxClearedStage: 0, battleUnlocked: true,
        rewardMode: mode, battleAttemptId: mode === 'cloud' ? 'old-attempt' : null,
        enemy: { stage: 1, name: stage.name, hp: status === 'victory' ? 0 : stage.hp, maxHp: stage.hp, attack: stage.attack, defense: stage.defense, xpReward: stage.xpReward },
        playerHp: 10, playerSnapshot: { name: 'old-player', level: 1, attack: 20, defense: 2, maxHp: 60 },
        actions: [{ type: 'attack' as const }], logs: [{ turn: 1, message: 'old-log', playerHp: 10, enemyHp: stage.hp }],
        skillCooldowns: { power_strike: 2 }, guardTurnsRemaining: 2, guardDamageReduction: 0.5,
    },
});
async function restore(saved: ReturnType<typeof fixture>) {
    await flushCompletionRewardWrites();
    localStorage.setItem('quest-board-game', JSON.stringify({ state: saved, version: 0 }));
    await act(async () => { await useGameStore.persist.rehydrate(); });
}
function button(text: string) { return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!; }
async function click(text: string) { const target = button(text); expect(target).toBeTruthy(); await act(async () => target.click()); }
async function render(path = '/map', strict = false) {
    history.replaceState({}, '', path); mounted = true;
    await act(async () => root.render(strict ? createElement(StrictMode, null, createElement(App)) : createElement(App)));
}
beforeEach(async () => {
    await import('../pages/MapBattlePage');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetAuthLifecycleHooks(); await notifyLogout();
    await flushCompletionRewardWrites(); setGameRewardAuthorityState('anonymous'); localStorage.clear();
    vi.clearAllMocks(); mocks.auth.mockResolvedValue({ kind: 'anonymous' });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
    withoutCompletionRewardPersistence(() => useGameStore.setState({ ...initial, battle: initial.battle, character: { ...initial.character, totalXp: 0 } }));
    useBattleHistoryStore.setState({ history: [] });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = false;
});
afterEach(async () => {
    if (mounted) await act(async () => root.unmount()); host.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals();
    await flushCompletionRewardWrites(); withoutCompletionRewardPersistence(() => useGameStore.setState(initial)); useBattleHistoryStore.setState({ history: [] }); history.replaceState({}, '', '/');
});

describe('Web persisted battle recovery through actual App', () => {
    it('returns an interrupted local battle to a usable map, then starts a fresh local battle', async () => {
        await restore(fixture('fighting')); await render('/map', true);
        expect(host.textContent).toContain('最高到達'); expect(button('スタート')).toBeTruthy();
        expect(useGameStore.getState().battle).toMatchObject({ status: 'idle', battleUnlocked: true, currentStage: 1, maxClearedStage: 0,
            enemy: null, actions: [], logs: [], skillCooldowns: {}, guardTurnsRemaining: 0, guardDamageReduction: 0 });
        expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useGameStore.getState().gachaCount).toBe(7);
        expect(useGameStore.getState().equipment.map((item) => item.id)).toEqual(['saved-item']);
        expect(useGameStore.getState().chestQueue).toMatchObject([{ id: 'saved-chest', opened: false }]);
        expect(useGameStore.getState().completionRewardKeys).toEqual(['task:saved-reward']);
        await click('スタート'); expect(useGameStore.getState().battle.status).toBe('fighting');
        expect(useGameStore.getState().battle.playerSnapshot).not.toBeNull(); expect(useGameStore.getState().battle.playerHp).toBe(useGameStore.getState().getEffectiveStats().maxHp);
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it.each(['fighting', 'victory', 'defeat'] as const)('does not restore cloud %s as a local battle or display a fabricated reward', async (status) => {
        await restore(fixture(status, 'cloud')); await render();
        expect(useGameStore.getState().battle).toMatchObject({ status: 'idle', enemy: null, actions: [], logs: [], battleAttemptId: null, playerSnapshot: null });
        expect(button('スタート')).toBeTruthy(); expect(button('次へ')).toBeUndefined(); expect(button('リトライ')).toBeUndefined();
        expect(host.textContent).not.toContain('XP を獲得');
        expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useGameStore.getState().battle.maxClearedStage).toBe(0);
        expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('retains confirmed cloud progress without replaying its result or reward UI', async () => {
        const saved = fixture('victory', 'cloud'); saved.battle.battleAttemptId = null; saved.battle.maxClearedStage = 1;
        await restore(saved); await render();
        expect(useGameStore.getState().battle).toMatchObject({ status: 'idle', maxClearedStage: 1, battleUnlocked: true });
        expect(host.textContent).not.toContain('XP を獲得'); expect(useGameStore.getState().character.totalXp).toBe(5);
        expect(mocks.resolve).not.toHaveBeenCalled(); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it.each(['local', 'markerless'])('keeps an old %s victory usable without regranting rewards', async (mode) => {
        const saved = fixture('victory');
        if (mode === 'markerless') Reflect.deleteProperty(saved.battle, 'rewardMode');
        await restore(saved); await render();
        expect(button('次へ').disabled).toBe(false); await click('次へ');
        expect(useGameStore.getState().battle).toMatchObject({ status: 'fighting', currentStage: 2, maxClearedStage: 1 });
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('keeps a local defeat retryable as a new battle', async () => {
        await restore(fixture('defeat')); await render(); await click('リトライ');
        expect(useGameStore.getState().battle).toMatchObject({ status: 'fighting', currentStage: 1, maxClearedStage: 0, rewardMode: 'local' });
        expect(useGameStore.getState().character.totalXp).toBe(5); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('preserves an ongoing in-memory battle during anonymous cross-tab storage updates', async () => {
        useGameStore.setState({ battle: { ...initial.battle, battleUnlocked: true } });
        useGameStore.getState().startBattle(1);
        const running = useGameStore.getState().battle;
        await flushCompletionRewardWrites();
        const saved = fixture('fighting'); saved.character.totalXp = 10;
        localStorage.setItem('quest-board-game', JSON.stringify({ state: saved, version: 0 }));
        syncAnonymousGameFromStorage();
        expect(useGameStore.getState().battle).toMatchObject({ status: 'fighting', currentStage: 1 });
        expect(useGameStore.getState().battle.playerSnapshot).toBe(running.playerSnapshot);
        expect(useGameStore.getState().battle.actions).toBe(running.actions); expect(useGameStore.getState().battle.enemy).toBe(running.enemy);
        expect(useGameStore.getState().character.totalXp).toBe(10); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('rejects contradictory stored attempt metadata instead of treating it as a local victory', async () => {
        const saved = fixture('victory'); saved.battle.battleAttemptId = 'unexpected-attempt';
        await restore(saved); await render(); expect(useGameStore.getState().battle.status).toBe('idle');
        expect(button('次へ')).toBeUndefined(); expect(button('スタート')).toBeTruthy(); expect(mocks.resolve).not.toHaveBeenCalled();
    });
});
