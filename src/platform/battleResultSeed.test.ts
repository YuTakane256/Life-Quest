import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureAuthSessionScope, notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { applyCloudCacheToWebStores } from './cloudSync';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from './completionRewards';
import { useGameStore } from '../stores/useGameStore';
import { useBattleHistoryStore } from '../stores/useBattleHistoryStore';

const initial = useGameStore.getInitialState();
const player = { name: 'hero', level: 1, attack: 10, defense: 5, maxHp: 100 };
const enemy = { stage: 1, name: 'enemy', hp: 0, maxHp: 10, attack: 2, defense: 1, xpReward: 5 };
function cache(character = {}, attempt = {}) {
    return applyPullBatchToCache(createEmptyCloudCache(), { next_cursor: 10, has_more: false,
        characters: [{ user_id: 'a', total_xp: 5, current_stage: 4, max_cleared_stage: 3, battle_unlocked: true, version: 10, ...character }],
        battle_attempts: [{ id: 'attempt-a', user_id: 'a', stage: 1, status: 'resolved', outcome: 'victory', version: 10, ...attempt }],
    });
}
beforeEach(async () => {
    await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); await notifyLogin('a'); localStorage.clear(); setGameRewardAuthorityState('authenticated');
    withoutCompletionRewardPersistence(() => useGameStore.setState({ ...initial, battle: { ...initial.battle, battleUnlocked: true,
        status: 'victory', currentStage: 1, battleAttemptId: 'attempt-a', rewardMode: 'cloud', playerSnapshot: player, enemy,
        actions: [{ type: 'attack' }], logs: [{ turn: 1, message: 'victory', playerHp: 100, enemyHp: 0 }] } }));
    useBattleHistoryStore.setState({ history: [] });
});
afterEach(async () => { await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); localStorage.clear(); setGameRewardAuthorityState('anonymous'); });

describe('Web confirmed battle result after authoritative game seed', () => {
    it('settles the matching runtime with authoritative XP and one history entry across repeated pulls', async () => {
        const old = useGameStore.getState().battle; applyCloudCacheToWebStores(cache()); applyCloudCacheToWebStores(cache()); const game = useGameStore.getState();
        expect(game.character.totalXp).toBe(5); expect(game.battle.battleAttemptId).toBeNull();
        expect(game.battle).toMatchObject({ status: 'victory', currentStage: 1, maxClearedStage: 3, logs: old.logs, actions: old.actions });
        expect(game.battle.playerSnapshot).toBe(old.playerSnapshot); expect(game.battle.enemy).toBe(old.enemy);
        expect(useBattleHistoryStore.getState().history).toHaveLength(1); expect(useBattleHistoryStore.getState().history[0]).toMatchObject({ stage: 1, outcome: 'victory', xpEarned: 5, logs: old.logs });
        await flushCompletionRewardWrites(); const stored = JSON.parse(localStorage.getItem('quest-board-game')!).state;
        expect(stored.completionRewardScope).toBe('cloud'); expect(stored.character.totalXp).toBe(5); expect(stored.battle.battleAttemptId).toBeNull();
    });
    it('settles a confirmed defeat without granting XP or advancing the runtime stage', () => {
        useGameStore.setState((game) => ({ battle: { ...game.battle, status: 'defeat' } }));
        applyCloudCacheToWebStores(cache({ total_xp: 0 }, { outcome: 'defeat' }));
        expect(useGameStore.getState().character.totalXp).toBe(0); expect(useGameStore.getState().battle.battleAttemptId).toBeNull();
        expect(useBattleHistoryStore.getState().history[0]).toMatchObject({ stage: 1, outcome: 'defeat', xpEarned: 0 });
    });
    it('settles defeat when SQL leaves the unchanged character older than the resolved attempt', () => {
        useGameStore.setState((game) => ({ battle: { ...game.battle, status: 'defeat', playerHp: 0 } }));
        const before = useGameStore.getState().battle;
        const defeated = cache({ total_xp: 0, version: 9 }, { outcome: 'defeat' });
        applyCloudCacheToWebStores(defeated);
        expect(useGameStore.getState().battle.battleAttemptId).toBeNull();
        expect(useGameStore.getState().character.totalXp).toBe(0);
        expect(useGameStore.getState().battle).toMatchObject({ status: 'defeat', currentStage: 1, playerHp: 0, logs: before.logs, actions: before.actions });
        expect(useBattleHistoryStore.getState().history).toHaveLength(1);
        const entry = useBattleHistoryStore.getState().history[0];
        expect(entry).toMatchObject({ stage: 1, outcome: 'defeat', xpEarned: 0 });
        useGameStore.getState().applyResolvedCloudBattle('attempt-a', 'defeat', false);
        applyCloudCacheToWebStores(defeated);
        expect(useBattleHistoryStore.getState().history).toEqual([entry]);
        expect(useGameStore.getState().character.totalXp).toBe(0);
    });
    it.each([
        { label: 'older character', character: { version: 9 }, attempt: {} },
        { label: 'unresolved attempt', character: {}, attempt: { status: 'in_progress' } },
        { label: 'other attempt', character: {}, attempt: { id: 'other' } },
        { label: 'other attempt owner', character: {}, attempt: { user_id: 'b' } },
        { label: 'other character owner', character: { user_id: 'b' }, attempt: {} },
        { label: 'different outcome', character: {}, attempt: { outcome: 'defeat' } },
        { label: 'different attempt stage', character: {}, attempt: { stage: 2 } },
    ])('keeps the pending result for $label', ({ character, attempt }) => {
        applyCloudCacheToWebStores(cache(character, attempt)); expect(useGameStore.getState().battle.battleAttemptId).toBe('attempt-a');
        expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it.each(['fighting', 'victory', 'defeat'] as const)('preserves the displayed %s stage when cloud progress prefers another stage', (status) => {
        useGameStore.setState((game) => ({ battle: { ...game.battle, status, rewardMode: 'local', battleAttemptId: null } }));
        applyCloudCacheToWebStores(cache()); expect(useGameStore.getState().battle.currentStage).toBe(1);
        expect(useGameStore.getState().battle.maxClearedStage).toBe(3); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('keeps the current pending cloud fight and its stage when another attempt is confirmed', () => {
        useGameStore.setState((game) => ({ battle: { ...game.battle, status: 'fighting' } })); applyCloudCacheToWebStores(cache({}, { id: 'other' }));
        expect(useGameStore.getState().battle).toMatchObject({ status: 'fighting', currentStage: 1, battleAttemptId: 'attempt-a' }); expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('uses cloud currentStage normally when no runtime is displayed', () => {
        useGameStore.getState().resetBattle(); applyCloudCacheToWebStores(cache());
        expect(useGameStore.getState().battle).toMatchObject({ status: 'idle', currentStage: 4, maxClearedStage: 3 });
        expect(useBattleHistoryStore.getState().history).toEqual([]);
    });
    it('does not settle a newer battle installed by a subscriber during seed', () => {
        let changed = false; const unsubscribe = useGameStore.subscribe((game) => {
            if (!changed && game.character.totalXp === 5) { changed = true; game.startCloudBattle(1, 'newer', { ...player }, { ...enemy, hp: 10 }); }
        });
        try { applyCloudCacheToWebStores(cache()); expect(useGameStore.getState().battle.battleAttemptId).toBe('newer'); expect(useBattleHistoryStore.getState().history).toEqual([]); }
        finally { unsubscribe(); }
    });
    it('does not acknowledge the old scope if authentication changes during seed', async () => {
        let changing: Promise<void> | undefined; const unsubscribe = useGameStore.subscribe((game) => { if (!changing && game.character.totalXp === 5) changing = notifyLogin('b'); });
        try { applyCloudCacheToWebStores(cache()); await changing; expect(useGameStore.getState().battle.battleAttemptId).toBe('attempt-a'); expect(useBattleHistoryStore.getState().history).toEqual([]); }
        finally { unsubscribe(); }
    });
    it('does not publish old-account history if authentication changes during acknowledgement', async () => {
        let changing: Promise<void> | undefined; const unsubscribe = useGameStore.subscribe((game) => {
            if (!changing && game.battle.battleAttemptId === null) { changing = notifyLogin('b'); useBattleHistoryStore.getState().clearHistory(); }
        });
        try { applyCloudCacheToWebStores(cache()); await changing; expect(captureAuthSessionScope().userId).toBe('b'); expect(useBattleHistoryStore.getState().history).toEqual([]); }
        finally { unsubscribe(); }
    });    it('does not publish old-account history if authentication changes while applying RPC XP', async () => {
        let changing: Promise<void> | undefined; const unsubscribe = useGameStore.subscribe((game) => {
            if (!changing && game.character.totalXp === 5) { changing = notifyLogin('b'); useBattleHistoryStore.getState().clearHistory(); }
        });
        try { useGameStore.getState().applyResolvedCloudBattle('attempt-a', 'victory', true); await changing;
            expect(captureAuthSessionScope().userId).toBe('b'); expect(useBattleHistoryStore.getState().history).toEqual([]); }
        finally { unsubscribe(); }
    });

});
