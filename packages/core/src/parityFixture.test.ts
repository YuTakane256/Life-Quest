import { describe, expect, it } from 'vitest';
import { createMobileParityStorage, createWebParityStorage, PARITY_FIXED_NOW } from './parityFixture.ts';
import { convertLegacyGameSnapshot, convertLegacyHabitSnapshot, convertLegacyTaskSnapshot } from './syncSnapshots.ts';

const state = (storage: Record<string, string>, key: string) => JSON.parse(storage[key]);

describe('shared anonymous reference fixture', () => {
    it.each(['light', 'dark'] as const)('rewards profile has the same chests and daily login state on both platforms (%s)', (theme) => {
        const web = createWebParityStorage(theme, 'rewards'); const mobile = createMobileParityStorage(theme, 'rewards');
        const game = convertLegacyGameSnapshot({ game: state(web, 'quest-board-game'), tasks: state(web, 'quest-board-tasks'), habits: state(web, 'quest-board-habits') });
        expect(state(mobile, 'quest-board-game').state).toEqual(game);
        expect(game.chestQueue).toHaveLength(2); expect(game.chestQueue[0].isStarterCharacter).toBe(true);
        expect(state(web, 'quest-board-login-bonus').state.anonymousState.lastLoginDate).toBe('2026-08-09');
        expect(state(mobile, 'quest-board-mobile-login-bonus').state.anonymousState.lastLoginDate).toBe('2026-08-09');
        expect(state(createMobileParityStorage(theme), 'quest-board-game').state.chestQueue).toHaveLength(0);
    });
    it.each(['light', 'dark'] as const)('battle profile only changes fictional progress, equally on both platforms (%s)', (theme) => {
        const web = createWebParityStorage(theme, 'battle');
        const mobile = createMobileParityStorage(theme, 'battle');
        const game = convertLegacyGameSnapshot({ game: state(web, 'quest-board-game'), tasks: state(web, 'quest-board-tasks'), habits: state(web, 'quest-board-habits') });
        expect(state(mobile, 'quest-board-game').state).toEqual(game);
        expect(game.battleProgress).toMatchObject({ maxClearedStage: 9, currentStage: 3 });
        expect(game.character.totalXp).toBe(330);
        expect(state(createWebParityStorage(theme), 'quest-board-game').state.battle.maxClearedStage).toBe(2);
    });
    it.each(['light', 'dark'] as const)('uses equivalent domain data and %s on both platforms', (theme) => {
        const web = createWebParityStorage(theme);
        const mobile = createMobileParityStorage(theme);
        expect(convertLegacyTaskSnapshot(state(mobile, 'quest-board-tasks'))).toEqual(convertLegacyTaskSnapshot(state(web, 'quest-board-tasks')));
        expect(convertLegacyHabitSnapshot(state(mobile, 'quest-board-habits'))).toEqual(convertLegacyHabitSnapshot(state(web, 'quest-board-habits')));
        const game = convertLegacyGameSnapshot({ game: state(web, 'quest-board-game'), tasks: state(web, 'quest-board-tasks'), habits: state(web, 'quest-board-habits') });
        expect(state(mobile, 'quest-board-game').state).toEqual(game);
        expect(game.character.totalXp).toBe(330);
        expect(game.rewardLedger.rewardedTaskIds).toContain('parity-completed-walk');
        expect(game.rewardLedger.rewardedSubtaskIds).toContain('parity-plan-week-draft');
        expect(state(mobile, 'quest-board-mobile-stats').state).toEqual({ ...state(web, 'quest-board-stats').state, seeded: true });
        expect(state(web, 'quest-board-theme').state.mode).toBe(theme);
        expect(state(mobile, 'quest-board-mobile-settings').state.themeMode).toBe(theme);
        expect(state(mobile, 'quest-board-mobile-login-bonus').state.anonymousState.lastLoginDate).toBe(PARITY_FIXED_NOW.slice(0, 10));
    });
    it('creates independent storage maps and has no session or account fixtures', () => {
        const storage = createMobileParityStorage();
        storage['quest-board-tasks'] = 'changed';
        expect(createMobileParityStorage()['quest-board-tasks']).not.toBe('changed');
        expect(Object.keys(storage).some((key) => /auth|session|token|supabase/.test(key))).toBe(false);
        expect(JSON.parse(storage['quest-board-game']).version).toBe(2);
    });
});
