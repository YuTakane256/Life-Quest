// @vitest-environment node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getExpoModuleMajorMismatches } from './expo-module-compatibility.mjs';

const require = createRequire(import.meta.url);
const mobile = require('../apps/mobile/package.json');
const root = require('../package.json');
const lock = require('../package-lock.json');
const mobileRequire = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
const bundled = mobileRequire('expo/bundledNativeModules.json');

describe('mobile dependency compatibility', () => {
    it('keeps native SVG pinned to the installed Expo SDK recommendation', () => {
        expect(mobile.dependencies['react-native-svg']).toBe(bundled['react-native-svg']);
        expect(lock.packages['node_modules/react-native-svg'].version)
            .toBe(mobile.dependencies['react-native-svg']);
    });

    it('keeps the mobile lock manifest consistent with package.json', () => {
        expect(lock.packages['apps/mobile'].dependencies).toEqual(mobile.dependencies);
        expect(lock.packages['apps/mobile'].devDependencies).toEqual(mobile.devDependencies);
        expect(lock.packages[''].dependencies).toEqual(root.dependencies);
        expect(lock.packages[''].devDependencies).toEqual(root.devDependencies);
    });

    it('resolves the same native SVG from the app and its hoisted icon peer', () => {
        expect(mobileRequire.resolve('react-native-svg')).toBe(require.resolve('react-native-svg'));
        expect(mobileRequire('react-native-svg/package.json').version).toBe(bundled['react-native-svg']);
    });

    it('keeps Reanimated and Worklets on the coordinated Expo native versions', () => {
        for (const name of ['react-native-reanimated', 'react-native-worklets']) {
            expect(mobileRequire(`${name}/package.json`).version).toBe(bundled[name]);
            expect(mobileRequire.resolve(name)).toBe(require.resolve(name));
        }
    });

    it('keeps the existing gesture-handler native baseline when router peers are resolved', () => {
        expect(root.overrides['react-native-gesture-handler']).toBe('3.0.2');
        expect(mobileRequire('react-native-gesture-handler/package.json').version).toBe('3.0.2');
        expect(mobileRequire.resolve('react-native-gesture-handler')).toBe(require.resolve('react-native-gesture-handler'));
    });

    it('uses one React instance across workspaces and the matching DOM renderer patch', () => {
        expect(mobileRequire.resolve('react')).toBe(require.resolve('react'));
        expect(require('react/package.json').version).toBe(require('react-dom/package.json').version);
    });

    it('does not mix another SDK major into installed Expo modules', () => {
        const installed = Object.fromEntries(Object.keys(mobile.dependencies)
            .filter((name) => name.startsWith('expo-') && bundled[name])
            .map((name) => [name, mobileRequire(`${name}/package.json`).version]));
        expect(getExpoModuleMajorMismatches(mobile.dependencies, bundled, installed)).toEqual([]);
    });

    it('uses the same icon release range on Web and Mobile', () => {
        expect(mobile.dependencies['lucide-react-native']).toBe(root.dependencies['lucide-react']);
    });
});

describe('Expo module compatibility guard regressions', () => {
    const dependencies = { 'expo-auth-session': '~57.0.14', 'expo-notifications': '~57.0.22', react: '19.3.0' };
    const expected = { 'expo-auth-session': '~57.0.14', 'expo-notifications': '~57.0.22', react: '19.2.3' };
    it('permits module patch/minor releases within the recommended major, without forcing an unrelated React downgrade', () => {
        expect(getExpoModuleMajorMismatches(dependencies, expected, { 'expo-auth-session': '57.0.16', 'expo-notifications': '57.1.0' })).toEqual([]);
    });
    it.each(['expo-auth-session', 'expo-notifications'])('rejects a standalone SDK 58 update of %s', (name) => {
        expect(getExpoModuleMajorMismatches(dependencies, expected, {
            'expo-auth-session': '57.0.14', 'expo-notifications': '57.0.22', [name]: '58.0.1',
        })).toEqual([{ name, installed: '58.0.1', expected: expected[name] }]);
    });
    it('rejects old modules after upgrading only the SDK core', () => {
        expect(getExpoModuleMajorMismatches(dependencies, { 'expo-auth-session': '~58.0.12', 'expo-notifications': '~58.1.4' }, {
            'expo-auth-session': '57.0.14', 'expo-notifications': '57.0.22',
        })).toHaveLength(2);
    });
    it('does not silently pass a missing module', () => {
        expect(getExpoModuleMajorMismatches(dependencies, expected, {})).toHaveLength(2);
    });
});

describe('Dependabot native dependency policy', () => {
    const config = require('js-yaml').load(readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8'));
    const npm = config.updates.find((update) => update['package-ecosystem'] === 'npm');
    it.each(['expo', 'expo-*'])('keeps %s SDK majors manual while allowing maintenance updates', (name) => {
        const rule = npm.ignore.find((entry) => entry['dependency-name'] === name);
        expect(rule?.['update-types']).toEqual(['version-update:semver-major']);
    });
    it('keeps independent SVG updates manual, including patches pinned by the SDK', () => {
        expect(npm.ignore.find((entry) => entry['dependency-name'] === 'react-native-svg')?.['update-types'])
            .toEqual(['version-update:semver-patch', 'version-update:semver-minor', 'version-update:semver-major']);
    });
});
