// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    getMaestroEnvironment,
    getMaestroTestCommand,
    getMobileParityFlow,
    getMobileParityPreflight,
    getReferenceTheme,
} from './run-mobile-parity-screenshots.mjs';

describe('getMaestroEnvironment', () => {
    it('uses a valid configured JAVA_HOME without invoking Homebrew', () => {
        const spawn = vi.fn();
        const result = getMaestroEnvironment({
            environment: { JAVA_HOME: '/custom/jdk', PATH: '/usr/bin' },
            spawn,
            executable: (filePath) => filePath === '/custom/jdk/bin/java',
        });

        expect(result).toEqual({
            ok: true,
            environment: {
                JAVA_HOME: '/custom/jdk',
                PATH: `/custom/jdk/bin:${'/usr/bin'}`,
            },
        });
        expect(spawn).not.toHaveBeenCalled();
    });

    it('fails clearly for an invalid configured JAVA_HOME without falling back', () => {
        const spawn = vi.fn();
        const result = getMaestroEnvironment({
            environment: { JAVA_HOME: '/invalid/jdk' },
            spawn,
            executable: () => false,
        });

        expect(result).toMatchObject({ ok: false, message: expect.stringContaining('/invalid/jdk/bin/java') });
        expect(spawn).not.toHaveBeenCalled();
    });

    it('discovers Homebrew OpenJDK only when JAVA_HOME is unset', () => {
        const spawn = vi.fn(() => ({ status: 0, stdout: '/opt/homebrew/opt/openjdk\n' }));
        const result = getMaestroEnvironment({
            environment: { PATH: '/usr/bin' },
            spawn,
            executable: (filePath) => filePath === '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java',
        });

        expect(spawn).toHaveBeenCalledWith('brew', ['--prefix', 'openjdk'], {
            encoding: 'utf8',
            stdio: 'pipe',
        });
        expect(result).toEqual({
            ok: true,
            environment: {
                JAVA_HOME: '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
                PATH: `/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin:${'/usr/bin'}`,
            },
        });
    });

    it('explains when neither JAVA_HOME nor Homebrew OpenJDK is available', () => {
        const result = getMaestroEnvironment({
            environment: {},
            spawn: () => ({ status: 1, stdout: '' }),
            executable: () => false,
        });

        expect(result).toMatchObject({ ok: false, message: expect.stringContaining('JAVA_HOME is not set') });
    });
});

describe('Mobile parity flow selection', () => {
    it.each(['__proto__', 'constructor', '../other.yaml'])('rejects non-allowlisted flow %s', (name) => {
        expect(getMobileParityFlow(name).ok).toBe(false);
    });
    it('allows reference only on an explicit parity capture manifest and never clears its data', () => {
        expect(getReferenceTheme({ extra: { expoClient: { extra: { appVariant: 'parity', parityCaptureTheme: 'light' } } } })).toBe('light');
        expect(getReferenceTheme({ extra: { appVariant: 'parity', parityCaptureTheme: 'dark' } })).toBe('dark');
        for (const extra of [{ appVariant: 'parity' }, { appVariant: 'release', parityCaptureTheme: 'dark' }, { appVariant: 'preview', parityCaptureTheme: 'light' }, { appVariant: 'parity', parityCaptureTheme: 'system' }]) {
            expect(() => getReferenceTheme({ extra })).toThrow(/Reference flow requires/);
        }
        const yaml = readFileSync(new URL('../.maestro/mobile-parity/capture-reference-screens.yaml', import.meta.url), 'utf8');
        expect(yaml).toContain('clearState: false');
        expect(yaml).not.toContain('clearState: true');
        expect(yaml).not.toContain('inputText:');
        expect(yaml).toContain('visible: "今週の計画を整理する.*"');
    });
    it.each(['screenshots', 'smoke'])('reconnects %s only to the isolated app and local Metro after clearing state', (name) => {
        const flow = getMobileParityFlow(name);
        const yaml = readFileSync(new URL(`../${flow.path}`, import.meta.url), 'utf8');
        expect(yaml).toMatch(/^appId: com\.yutakane\.lifequest\.parity\n/);
        expect(yaml).toContain('- launchApp:\n    clearState: true');
        expect(yaml).toContain('- openLink: "lifequest-parity://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081&disableOnboarding=1&disableAutoLaunch=1&disableFab=1"');
        expect(yaml.indexOf('- openLink:')).toBeGreaterThan(yaml.indexOf('clearState: true'));
        expect(yaml).not.toContain('lifequest://');
        expect(yaml).not.toContain('exp+life-quest://');
        expect(yaml).toContain('visible: "ログインボーナス.*"');
        expect(yaml.indexOf('notVisible: "ログインボーナス.*"')).toBeLessThan(yaml.indexOf('visible: "タスク"'));
    });
    it('checks the disabled map tab and restarts smoke without clearing persistence', () => {
        const yaml = readFileSync(new URL('../.maestro/mobile-parity/anonymous-critical-path.yaml', import.meta.url), 'utf8');
        expect(yaml).toContain('- assertVisible:\n    text: ".*マップ.*"\n    enabled: false');
        expect(yaml).toContain('- stopApp\n- launchApp:\n    clearState: false');
        expect(yaml.match(/clearState: true/g)).toHaveLength(1);
    });
    it('keeps the screenshot command pinned to its single capture YAML', () => {
        const flow = getMobileParityFlow();

        expect(flow).toEqual({
            ok: true,
            name: 'screenshots',
            path: '.maestro/mobile-parity/capture-major-screens.yaml',
        });
        expect(getMaestroTestCommand(flow)).toEqual([
            'test',
            '.maestro/mobile-parity/capture-major-screens.yaml',
        ]);
    });

    it('only permits the checked-in smoke flow and builds its exact Maestro command', () => {
        const flow = getMobileParityFlow('smoke');

        expect(flow).toEqual({
            ok: true,
            name: 'smoke',
            path: '.maestro/mobile-parity/anonymous-critical-path.yaml',
        });
        expect(getMaestroTestCommand(flow)).toEqual([
            'test',
            '.maestro/mobile-parity/anonymous-critical-path.yaml',
        ]);
    });

    it('rejects an arbitrary flow path before it could be given to Maestro', () => {
        expect(getMobileParityFlow('../../other-app-flow.yaml')).toMatchObject({
            ok: false,
            message: expect.stringContaining('Unknown Mobile parity flow'),
        });
    });
});

describe('getMobileParityPreflight', () => {
    it('stops before checking the app when no simulator is booted', () => {
        const spawn = vi.fn((command, args) => {
            if (command === 'maestro') return { status: 0 };
            if (args.join(' ') === 'simctl list devices booted -j') {
                return { status: 0, stdout: JSON.stringify({ devices: { 'iOS 18': [] } }) };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
        });

        const result = getMobileParityPreflight({ environment: { PATH: '/usr/bin' }, spawn });

        expect(result).toMatchObject({ ok: false, message: expect.stringContaining('No booted iOS simulator') });
        expect(spawn).toHaveBeenCalledTimes(2);
        expect(spawn.mock.calls).not.toContainEqual(expect.arrayContaining([
            'xcrun',
            expect.arrayContaining(['get_app_container']),
        ]));
    });

    it('fails before running a test when the fixed parity app is not installed', () => {
        const spawn = vi.fn((command, args) => {
            if (command === 'maestro') return { status: 0 };
            if (args.join(' ') === 'simctl list devices booted -j') {
                return { status: 0, stdout: JSON.stringify({ devices: { 'iOS 18': [{ state: 'Booted' }] } }) };
            }
            if (args.join(' ') === 'simctl get_app_container booted com.yutakane.lifequest.parity app') {
                return { status: 1 };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
        });

        const result = getMobileParityPreflight({ environment: { PATH: '/usr/bin' }, spawn });

        expect(result).toMatchObject({ ok: false, message: expect.stringContaining('com.yutakane.lifequest.parity') });
        expect(spawn.mock.calls).not.toContainEqual(expect.arrayContaining([
            'maestro',
            expect.arrayContaining(['test']),
        ]));
    });

    it('checks the fixed parity bundle before allowing a flow to start', () => {
        const environment = { PATH: '/usr/bin' };
        const spawn = vi.fn((command, args) => {
            if (args.join(' ') === 'simctl list devices booted -j') {
                return { status: 0, stdout: JSON.stringify({ devices: { 'iOS 18': [{ state: 'Booted' }] } }) };
            }
            if (args.join(' ') === 'simctl get_app_container booted com.yutakane.lifequest.parity app') {
                return { status: 0 };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
        });

        expect(getMobileParityPreflight({ environment, spawn, hasCommand: () => true })).toEqual({ ok: true });
        expect(spawn).toHaveBeenLastCalledWith(
            'xcrun',
            ['simctl', 'get_app_container', 'booted', 'com.yutakane.lifequest.parity', 'app'],
            { stdio: 'ignore', env: environment },
        );
    });
});
