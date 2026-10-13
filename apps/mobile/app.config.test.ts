import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import appConfig from './app.config';

const context = { config: { name: 'Life Quest', slug: 'life-quest' } } as Parameters<typeof appConfig>[0];
beforeEach(() => {
    vi.stubEnv('LIFE_QUEST_APP_VARIANT', 'release');
    vi.stubEnv('LIFE_QUEST_PARITY_CAPTURE', '');
    vi.stubEnv('LIFE_QUEST_PARITY_PROFILE', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('capture profile public configuration safety', () => {
    it('leaves the normal release identity and capture flags unchanged', () => {
        const config = appConfig(context);
        expect(config.ios?.bundleIdentifier).toBe('com.yutakane.lifequest');
        expect(config.extra?.parityCaptureTheme).toBeUndefined();
        expect(config.extra?.parityCaptureProfile).toBeUndefined();
    });
    it('permits the battle profile only with an explicit parity capture theme', () => {
        vi.stubEnv('LIFE_QUEST_APP_VARIANT', 'parity');
        vi.stubEnv('LIFE_QUEST_PARITY_CAPTURE', 'dark');
        vi.stubEnv('LIFE_QUEST_PARITY_PROFILE', 'battle');
        expect(appConfig(context).extra).toMatchObject({ appVariant: 'parity', parityCaptureTheme: 'dark', parityCaptureProfile: 'battle' });
    });
    it.each(['release', 'preview'])('rejects the battle profile for %s even with a theme', (variant) => {
        vi.stubEnv('LIFE_QUEST_APP_VARIANT', variant);
        vi.stubEnv('LIFE_QUEST_PARITY_CAPTURE', 'dark');
        vi.stubEnv('LIFE_QUEST_PARITY_PROFILE', 'battle');
        expect(() => appConfig(context)).toThrow();
    });
    it('rejects a profile without a theme and unknown profile values', () => {
        vi.stubEnv('LIFE_QUEST_APP_VARIANT', 'parity');
        vi.stubEnv('LIFE_QUEST_PARITY_PROFILE', 'battle');
        expect(() => appConfig(context)).toThrow(/requires parity capture/);
        vi.stubEnv('LIFE_QUEST_PARITY_CAPTURE', 'dark');
        vi.stubEnv('LIFE_QUEST_PARITY_PROFILE', 'unknown');
        expect(() => appConfig(context)).toThrow(/daily\/battle/);
    });
});
