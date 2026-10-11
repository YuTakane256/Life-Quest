import { afterEach, describe, expect, it, vi } from 'vitest';
import { PARITY_FIXED_NOW } from '@life-quest/core/parityFixture';
import { getCaptureTheme, installCaptureRuntime, type CaptureContext, type CaptureStorage } from './captureRuntime';

const context: CaptureContext = { development: true, variant: 'parity', applicationId: 'com.yutakane.lifequest.parity', theme: 'dark', supabaseUrl: undefined, supabaseKey: undefined };
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

describe('reference capture safety', () => {
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
