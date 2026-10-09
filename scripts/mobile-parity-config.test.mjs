// @vitest-environment node
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import appConfig from '../apps/mobile/app.config.ts';

const require = createRequire(import.meta.url);
const { withPlugins } = require('expo/config-plugins');
const withParityIOS = require('../apps/mobile/plugins/with-parity-ios.cjs');
const projectRoot = fileURLToPath(new URL('../apps/mobile', import.meta.url));
const baseConfig = require('../apps/mobile/app.json').expo;

afterEach(() => vi.unstubAllEnvs());

async function nativeEntitlements(variant, existing = {}) {
    vi.stubEnv('LIFE_QUEST_APP_VARIANT', variant);
    const config = appConfig({ config: baseConfig });
    const compiled = withPlugins({ ...config, _internal: { projectRoot } }, config.plugins);
    const result = await compiled.mods.ios.entitlements({
        ...compiled,
        modResults: { ...existing },
        modRequest: { projectRoot, platformProjectRoot: `${projectRoot}/ios`, platform: 'ios', modName: 'entitlements' },
    });
    return { config, entitlements: result.modResults };
}

describe('anonymous parity iOS signing configuration', () => {
    it('removes Apple sign-in even from an existing native project, preserving other entitlements', async () => {
        const { config, entitlements } = await nativeEntitlements('parity', {
            'com.apple.developer.applesignin': ['Default'],
            'aps-environment': 'development',
        });
        expect(config.ios.usesAppleSignIn).toBe(false);
        expect(config.ios.bundleIdentifier).toBe('com.yutakane.lifequest.parity');
        expect(entitlements).not.toHaveProperty('com.apple.developer.applesignin');
        expect(entitlements['aps-environment']).toBe('development');
    });

    it.each(['release', 'preview'])('keeps Apple sign-in enabled for %s builds', async (variant) => {
        const { config, entitlements } = await nativeEntitlements(variant);
        expect(config.ios.usesAppleSignIn).toBe(true);
        expect(entitlements['com.apple.developer.applesignin']).toEqual(['Default']);
        expect(config.plugins).not.toContain('./plugins/with-parity-ios.cjs');
    });

    it('refuses to remove the entitlement from a normal app', () => {
        expect(() => withParityIOS({ extra: { appVariant: 'release' }, ios: { bundleIdentifier: 'com.yutakane.lifequest' } }))
            .toThrow('only allowed for the isolated parity app');
    });
});
