import { describe, expect, it, vi } from 'vitest';
import {
    getMaestroEnvironment,
    getMaestroTestCommand,
    getMobileParityFlow,
    getMobileParityPreflight,
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
