import { afterEach, describe, expect, it, vi } from 'vitest';
import { PARITY_FIXED_NOW } from '@life-quest/core/parityFixture';
import { getCaptureProfile, getCaptureTheme, installCaptureRuntime, type CaptureContext, type CaptureStorage } from './captureRuntime';

const context: CaptureContext = { development: true, variant: 'parity', applicationId: 'com.yutakane.lifequest.parity', theme: 'dark', supabaseUrl: undefined, supabaseKey: undefined };
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

describe('reference capture safety', () => {
    it('isolates history fixtures from normal/preview/account storage', async () => {
        expect(getCaptureProfile(context, 'history')).toBe('history');
        for (const change of [{ development: false }, { theme: undefined }, { variant: 'preview' }, { applicationId: 'com.yutakane.lifequest' }, { supabaseUrl: 'https://example.test' }, { supabaseKey: 'configured' }]) {
            expect(() => getCaptureProfile({ ...context, ...change }, 'history')).toThrow();
        }
        const real = vi.fn(async () => { throw new Error('Real storage must not be touched'); });
        const storage = Object.fromEntries(['getItem', 'setItem', 'removeItem', 'getMany', 'setMany', 'removeMany', 'getAllKeys', 'clear'].map((key) => [key, real])) as unknown as CaptureStorage;
        restore = installCaptureRuntime(storage, 'light', 'history');
        expect(JSON.parse((await storage.getItem('quest-board-game'))!).state.chestQueue.filter((chest: { opened: boolean }) => chest.opened)).toHaveLength(3);
        await storage.clear(); expect(real).not.toHaveBeenCalled();
    });
    it('isolates reward chests and a pending daily login only under the full capture guard', async () => {
        expect(getCaptureProfile(context, 'rewards')).toBe('rewards');
        for (const change of [{ development: false }, { theme: undefined }, { variant: 'preview' }, { supabaseKey: 'configured' }]) {
            expect(() => getCaptureProfile({ ...context, ...change }, 'rewards')).toThrow();
        }
        const real = vi.fn(async () => { throw new Error('Real storage must not be touched'); });
        const storage = Object.fromEntries(['getItem', 'setItem', 'removeItem', 'getMany', 'setMany', 'removeMany', 'getAllKeys', 'clear'].map((key) => [key, real])) as unknown as CaptureStorage;
        restore = installCaptureRuntime(storage, 'dark', 'rewards');
        const game = JSON.parse((await storage.getItem('quest-board-game'))!).state;
        expect(game.chestQueue).toHaveLength(2); expect(game.equipment).toHaveLength(7);
        expect(game.chestQueue[0].isStarterCharacter).toBe(true);
        await storage.setItem('quest-board-game', 'opened only in memory');
        expect(real).not.toHaveBeenCalled();
    });
    it('only permits battle fixtures inside the existing full isolation guard', () => {
        expect(getCaptureProfile(context, 'battle')).toBe('battle');
        expect(getCaptureProfile(context, undefined)).toBe('daily');
        expect(() => getCaptureProfile(context, 'unknown')).toThrow();
        for (const change of [{ theme: undefined }, { development: false }, { variant: 'preview' }, { applicationId: 'com.yutakane.lifequest' }, { supabaseUrl: 'https://example.test' }, { supabaseKey: 'configured' }]) {
            expect(() => getCaptureProfile({ ...context, ...change }, 'battle')).toThrow();
        }
    });
    it('uses only memory for battle progress, retaining the original storage methods', async () => {
        const real = vi.fn(async () => { throw new Error('Real storage must not be touched'); });
        const storage = Object.fromEntries(['getItem', 'setItem', 'removeItem', 'getMany', 'setMany', 'removeMany', 'getAllKeys', 'clear'].map((key) => [key, real])) as unknown as CaptureStorage;
        restore = installCaptureRuntime(storage, 'dark', 'battle');
        const game = JSON.parse((await storage.getItem('quest-board-game'))!);
        expect(game.state.battleProgress.maxClearedStage).toBe(9);
        await storage.setItem('quest-board-game', 'fictional update');
        await storage.clear();
        expect(real).not.toHaveBeenCalled();
    });
    it('does not activate for normal development and keeps either explicit theme', () => {
        expect(getCaptureTheme({ ...context, theme: undefined })).toBeNull();
        expect(getCaptureTheme(context)).toBe('dark');
        expect(getCaptureTheme({ ...context, theme: 'light' })).toBe('light');
    });
    it.each([
        { development: false }, { variant: 'release' }, { variant: 'preview' },
        { applicationId: 'com.yutakane.lifequest' }, { applicationId: null },
        { supabaseUrl: 'https://example.test' }, { supabaseKey: 'test-key' }, { theme: 'system' },
    ])('rejects unsafe context %j', (change) => {
        expect(() => getCaptureTheme({ ...context, ...change })).toThrow(/anonymous parity development/);
    });
    it('isolates every storage operation, including clear, without reading or deleting real data', async () => {
        const real = vi.fn(async () => { throw new Error('Real storage must not be touched'); });
        const storage = Object.fromEntries(['getItem', 'setItem', 'removeItem', 'getMany', 'setMany', 'removeMany', 'getAllKeys', 'clear'].map((key) => [key, real])) as unknown as CaptureStorage;
        restore = installCaptureRuntime(storage, 'light');
        expect(await storage.getItem('personal-data')).toBeNull();
        expect(await storage.getItem('quest-board-tasks')).toContain('今週の計画を整理する');
        await storage.setItem('temporary', 'value');
        expect(await storage.getMany(['temporary', 'absent'])).toEqual({ temporary: 'value', absent: null });
        await storage.setMany({ a: '1', b: '2' });
        await storage.removeItem('temporary');
        await storage.removeMany(['a', 'b']);
        expect(await storage.getAllKeys()).not.toContain('temporary');
        await storage.clear();
        expect(await storage.getAllKeys()).toEqual([]);
        expect(real).not.toHaveBeenCalled();
        restore(); restore = undefined;
        expect(storage.getItem).toBe(real);
    });
    it('fixes implicit dates but preserves explicit dates, parsing, instanceof and timers', async () => {
        const storage = {} as CaptureStorage;
        restore = installCaptureRuntime(storage, 'dark');
        expect(new Date().toISOString()).toBe(PARITY_FIXED_NOW);
        expect(Date.now()).toBe(Date.parse(PARITY_FIXED_NOW));
        expect(Date()).toBe(new Date(PARITY_FIXED_NOW).toString());
        expect(new Date('2020-01-01').getUTCFullYear()).toBe(2020);
        expect(new Date(2020, 0, 1)).toBeInstanceOf(Date);
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        expect(new Date().toISOString()).toBe(PARITY_FIXED_NOW);
    });
});
