import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { createBattleEngineState, type BattleActors } from '@life-quest/core/battle';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import { applyCloudCacheToMobileStores } from './cloudSeed';
import { useMobileGameStore } from '../stores/useMobileGameStore';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
const actors: BattleActors = { player: { attack: 10, defense: 5, maxHp: 100 }, playerLevel: 1, playerName: 'hero',
    enemy: { stage: 1, name: 'enemy', maxHp: 10, attack: 2, defense: 1, xpReward: 5 } };
function cache(character = {}, attempt = {}) {
    return applyPullBatchToCache(createEmptyCloudCache(), { next_cursor: 10, has_more: false,
        characters: [{ user_id: 'a', total_xp: 5, max_cleared_stage: 1, battle_unlocked: true, version: 10, ...character }],
        battle_attempts: [{ id: 'attempt-a', user_id: 'a', stage: 1, status: 'resolved', outcome: 'victory', version: 10, ...attempt }],
    });
}
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a');
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true,
        battleProgress: { battleUnlocked: true, currentStage: 1, maxClearedStage: 0 },
        activeBattle: { stage: 1, actors, state: { ...createBattleEngineState(actors), outcome: 'victory' },
            actions: [{ type: 'attack' }], battleAttemptId: 'attempt-a', rewardMode: 'cloud' } });
});
afterEach(() => resetAuthLifecycleHooks());

describe('Mobile cloud result acknowledgement after authoritative game seed', () => {
    it('settles the matching result without adding XP and preserves its displayed runtime', () => {
        const before = useMobileGameStore.getState().activeBattle!;
        expect(applyCloudCacheToMobileStores(cache())).toBe(true); const game = useMobileGameStore.getState();
        expect(game.character.totalXp).toBe(5); expect(game.activeBattle).toEqual({ ...before, battleAttemptId: null });
        expect(game.battleProgress.maxClearedStage).toBe(1);
    });
    it('settles a confirmed defeat with a sufficiently new character snapshot without granting XP', () => {
        useMobileGameStore.setState((game) => ({ activeBattle: { ...game.activeBattle!, state: { ...game.activeBattle!.state, outcome: 'defeat' } } }));
        applyCloudCacheToMobileStores(cache({ total_xp: 0, max_cleared_stage: 0 }, { outcome: 'defeat' }));
        expect(useMobileGameStore.getState().character.totalXp).toBe(0); expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBeNull();
    });
    it('settles defeat when SQL leaves the unchanged character older than the resolved attempt', () => {
        useMobileGameStore.setState((game) => ({ activeBattle: { ...game.activeBattle!, state: { ...game.activeBattle!.state, outcome: 'defeat', playerHp: 0 } } }));
        const before = useMobileGameStore.getState().activeBattle!;
        const defeated = cache({ total_xp: 0, version: 9, max_cleared_stage: 0 }, { outcome: 'defeat' });
        applyCloudCacheToMobileStores(defeated);
        expect(useMobileGameStore.getState().activeBattle).toEqual({ ...before, battleAttemptId: null });
        expect(useMobileGameStore.getState().character.totalXp).toBe(0);
        expect(useMobileGameStore.getState().battleProgress.maxClearedStage).toBe(0);
        useMobileGameStore.getState().applyResolvedCloudBattle('attempt-a', 'defeat', false);
        applyCloudCacheToMobileStores(defeated);
        expect(useMobileGameStore.getState().activeBattle).toEqual({ ...before, battleAttemptId: null });
        expect(useMobileGameStore.getState().character.totalXp).toBe(0);
    });
    it.each([
        { label: 'older character', character: { version: 9 }, attempt: {} },
        { label: 'unresolved attempt', character: {}, attempt: { status: 'in_progress' } },
        { label: 'other attempt', character: {}, attempt: { id: 'other' } },
        { label: 'other attempt owner', character: {}, attempt: { user_id: 'b' } },
        { label: 'other character owner', character: { user_id: 'b' }, attempt: {} },
        { label: 'different outcome', character: {}, attempt: { outcome: 'defeat' } },
    ])('keeps the pending result for $label', ({ character, attempt }) => {
        applyCloudCacheToMobileStores(cache(character, attempt)); expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe('attempt-a');
    });
    it('does not clear a newer battle installed by a game-store subscriber during seed', () => {
        let changed = false; const unsubscribe = useMobileGameStore.subscribe((game) => {
            if (!changed && game.character.totalXp === 5) { changed = true; game.startCloudBattle(1, 'newer', { ...actors }); }
        });
        try { applyCloudCacheToMobileStores(cache()); expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe('newer'); }
        finally { unsubscribe(); }
    });
    it('does not acknowledge an old scope if authentication changes during seed', async () => {
        let changing: Promise<void> | undefined;
        const unsubscribe = useMobileGameStore.subscribe((game) => { if (!changing && game.character.totalXp === 5) changing = notifyLogin('b'); });
        try { applyCloudCacheToMobileStores(cache()); await changing; expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe('attempt-a'); }
        finally { unsubscribe(); }
    });
});
