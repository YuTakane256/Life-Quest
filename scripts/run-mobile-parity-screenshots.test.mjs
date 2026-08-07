import { describe, expect, it, vi } from 'vitest';
import { getMaestroEnvironment } from './run-mobile-parity-screenshots.mjs';

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
