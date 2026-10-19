// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    getMaestroEnvironment,
    getMaestroTestCommand,
    getMobileParityFlow,
    getMobileParityPreflight,
    getReferenceTheme,
    assertReferenceProfile,
    assertPersistentParityRuntime,
    requiresReferenceRuntime,
    getMobileParityMetroUrl,
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
    it('guards draft-conflict/tab tests with a local-only daily memory runtime on 8082', () => {
        expect(getMobileParityMetroUrl('taskDraft')).toBe('http://127.0.0.1:8082');
        expect(requiresReferenceRuntime('taskDraft')).toBe(true);
        const extra = { appVariant: 'parity', parityLocalOnly: true, parityCaptureTheme: 'dark' };
        expect(() => assertReferenceProfile({ extra }, 'taskDraft')).not.toThrow();
        for (const change of [{ parityLocalOnly: false }, { parityLocalOnly: undefined }, { parityCaptureProfile: 'battle' }, { parityCaptureProfile: 'rewards' }, { appVariant: 'release' }]) {
            expect(() => assertReferenceProfile({ extra: { ...extra, ...change } }, 'taskDraft')).toThrow();
        }
        const yaml = readFileSync(new URL(`../${getMobileParityFlow('taskDraft').path}`, import.meta.url), 'utf8');
        expect(yaml).not.toContain('clearState:'); expect(yaml).not.toContain('- launchApp');
        expect(yaml).toContain('127.0.0.1%3A8082'); expect(yaml).toContain('このタスクは変更または削除されています');
        expect(yaml).toContain('Draft tab reset');
    });
    it('keeps task form checks memory-only, on 8082, and requires a visible software keyboard', () => {
        expect(getMobileParityMetroUrl('taskForm')).toBe('http://127.0.0.1:8082');
        expect(requiresReferenceRuntime('taskForm')).toBe(true);
        const extra = { appVariant: 'parity', parityLocalOnly: true, parityCaptureTheme: 'light' };
        expect(() => assertReferenceProfile({ extra }, 'taskForm')).not.toThrow();
        for (const change of [{ parityLocalOnly: false }, { parityLocalOnly: undefined }, { parityCaptureProfile: 'rewards' }, { parityCaptureProfile: 'battle' }, { appVariant: 'release' }]) {
            expect(() => assertReferenceProfile({ extra: { ...extra, ...change } }, 'taskForm')).toThrow();
        }
        const yaml = readFileSync(new URL(`../${getMobileParityFlow('taskForm').path}`, import.meta.url), 'utf8');
        expect(yaml).not.toContain('clearState:'); expect(yaml).not.toContain('- launchApp');
        expect(yaml).toContain('127.0.0.1%3A8082');
        expect(yaml).toContain('id: "Done"'); expect(yaml).toContain('- tapOn: "更新"');
    });
    it('uses a second local-only rewards runtime without stopping normal inspection on 8081', () => {
        expect(getMobileParityMetroUrl('rewards')).toBe('http://127.0.0.1:8082');
        expect(getMobileParityMetroUrl('battle')).toBe('http://127.0.0.1:8081');
        expect(requiresReferenceRuntime('rewards')).toBe(true);
        const extra = { appVariant: 'parity', parityLocalOnly: true, parityCaptureTheme: 'dark', parityCaptureProfile: 'rewards' };
        expect(() => assertReferenceProfile({ extra }, 'rewards')).not.toThrow();
        for (const change of [{ parityLocalOnly: false }, { parityCaptureProfile: 'daily' }, { parityCaptureProfile: 'battle' }, { appVariant: 'release' }]) {
            expect(() => assertReferenceProfile({ extra: { ...extra, ...change } }, 'rewards')).toThrow();
        }
        const yaml = readFileSync(new URL(`../${getMobileParityFlow('rewards').path}`, import.meta.url), 'utf8');
        expect(yaml).toContain('clearState: false'); expect(yaml).not.toContain('clearState: true');
        expect(yaml).toContain('127.0.0.1%3A8082'); expect(yaml).toContain('ログインボーナスを閉じる');
        expect(yaml).toContain('インベントリ（8）');
    });
    it('runs undo/add layout checks only in guarded memory-only reference mode', () => {
        expect(requiresReferenceRuntime('undo')).toBe(true);
        const flow = getMobileParityFlow('undo');
        expect(flow).toMatchObject({ ok: true, path: '.maestro/mobile-parity/task-undo-actions.yaml' });
        const extra = { appVariant: 'parity', parityCaptureTheme: 'light', parityLocalOnly: true };
        expect(() => assertReferenceProfile({ extra }, 'undo')).not.toThrow();
        for (const parityLocalOnly of [false, undefined]) {
            expect(() => assertReferenceProfile({ extra: { ...extra, parityLocalOnly } }, 'undo')).toThrow(/no Supabase/);
        }
        expect(() => assertReferenceProfile({ extra: { ...extra, parityCaptureProfile: 'battle' } }, 'undo')).toThrow(/Battle flow/);
        const yaml = readFileSync(new URL(`../${flow.path}`, import.meta.url), 'utf8');
        expect(yaml).toContain('clearState: false');
        expect(yaml).not.toContain('clearState: true');
        expect(yaml).toContain('text: "新しいタスクを追加"\n    waitToSettleTimeoutMs: 200\n- tapOn: "取消する"\n- assertVisible: "タスク追加フォームを閉じる"');
        expect(yaml).toContain('undo-${REFERENCE_THEME}-input');
    });
    it('only allows real local persistence and never a reference/cloud/unknown runtime', () => {
        const extra = { appVariant: 'parity', parityLocalOnly: true };
        expect(() => assertPersistentParityRuntime({ extra })).not.toThrow();
        expect(() => assertPersistentParityRuntime({ extra: { expoClient: { extra } } })).not.toThrow();
        for (const invalid of [undefined, {}, { ...extra, appVariant: 'release' }, { ...extra, appVariant: 'preview' },
            { ...extra, parityLocalOnly: false }, { appVariant: 'parity' },
            { ...extra, parityCaptureTheme: 'dark' }, { ...extra, parityCaptureProfile: 'battle' }]) {
            expect(() => assertPersistentParityRuntime({ extra: invalid })).toThrow(/mobile:start:anonymous/);
        }
    });
    it('keeps progression isolated and checks actual restart and reward stability', () => {
        expect(requiresReferenceRuntime('progression')).toBe(false);
        const flow = getMobileParityFlow('progression');
        expect(flow).toMatchObject({ ok: true, path: '.maestro/mobile-parity/anonymous-progression.yaml' });
        const yaml = readFileSync(new URL(`../${flow.path}`, import.meta.url), 'utf8');
        expect(yaml).toMatch(/^appId: com\.yutakane\.lifequest\.parity\n/);
        expect(yaml.match(/clearState: true/g)).toHaveLength(1);
        expect(yaml).toContain('- stopApp\n- launchApp:\n    clearState: false');
        expect(yaml).toContain('青色の宝箱を開封する');
        expect(yaml).toContain('ステージ 2 スタート');
        expect(yaml.match(/maestro\.copiedText == output\.victoryXp/g)).toHaveLength(2);
        const helper = readFileSync(new URL('../.maestro/mobile-parity/progression-create-task.yaml', import.meta.url), 'utf8');
        expect(helper).not.toContain('launchApp');
        expect(helper).not.toContain('clearState');
    });
    it('requires the explicit battle profile and rejects mismatched capture flows', () => {
        const manifest = (profile) => ({ extra: { appVariant: 'parity', parityCaptureTheme: 'dark', parityCaptureProfile: profile } });
        expect(() => assertReferenceProfile(manifest('battle'), 'battle')).not.toThrow();
        expect(() => assertReferenceProfile(manifest(undefined), 'reference')).not.toThrow();
        expect(() => assertReferenceProfile(manifest(undefined), 'battle')).toThrow(/Battle flow/);
        expect(() => assertReferenceProfile(manifest('battle'), 'map')).toThrow(/Battle flow/);
        expect(() => assertReferenceProfile(manifest('other'), 'battle')).toThrow(/Battle flow/);
        expect(requiresReferenceRuntime('battle')).toBe(true);
        const yaml = readFileSync(new URL(`../${getMobileParityFlow('battle').path}`, import.meta.url), 'utf8');
        expect(yaml).toContain('clearState: false');
        expect(yaml).not.toContain('clearState: true');
        expect(yaml).toContain('リトライ');
    });
    it('isolates map combat checks to the guarded memory-only runtime', () => {
        expect(requiresReferenceRuntime('map')).toBe(true);
        const flow = getMobileParityFlow('map');
        expect(flow.ok).toBe(true);
        const yaml = readFileSync(new URL(`../${flow.path}`, import.meta.url), 'utf8');
        expect(yaml).toMatch(/^appId: com\.yutakane\.lifequest\.parity\n/);
        expect(yaml).toContain('clearState: false');
        expect(yaml).not.toContain('clearState: true');
        expect(yaml).toContain('ステージ 4 スタート');
    });
    it('battle/map/progression flows wait for automatic combat instead of pressing removed attack controls', () => {
        for (const name of ['battle', 'map', 'progression']) {
            const yaml = readFileSync(new URL(`../${getMobileParityFlow(name).path}`, import.meta.url), 'utf8');
            expect(yaml).not.toMatch(/- tapOn: "通常攻撃"/);
            expect(yaml).not.toMatch(/- tapOn: "戦闘を閉じる"/);
            expect(yaml).toContain('visible: "勝利！"');
        }
    });
    it('isolates character edits and equipment checks to the guarded memory-only runtime', () => {
        expect(requiresReferenceRuntime('character')).toBe(true);
        const flow = getMobileParityFlow('character');
        expect(flow.ok).toBe(true);
        const yaml = readFileSync(new URL(`../${flow.path}`, import.meta.url), 'utf8');
        expect(yaml).toMatch(/^appId: com\.yutakane\.lifequest\.parity\n/);
        expect(yaml).toContain('clearState: false');
        expect(yaml).not.toContain('clearState: true');
        expect(yaml).toContain('プロフィールを編集');
    });
    it('isolates daily form interactions to the guarded memory-only reference runtime', () => {
        expect(requiresReferenceRuntime('daily')).toBe(true);
        expect(requiresReferenceRuntime('reference')).toBe(true);
        expect(requiresReferenceRuntime('smoke')).toBe(false);
        const flow = getMobileParityFlow('daily');
        expect(flow.ok).toBe(true);
        const yaml = readFileSync(new URL(`../${flow.path}`, import.meta.url), 'utf8');
        expect(yaml).toMatch(/^appId: com\.yutakane\.lifequest\.parity\n/);
        expect(yaml).toContain('clearState: false');
        expect(yaml).not.toContain('clearState: true');
        expect(yaml).toContain('入力してください。');
    });
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
        expect(yaml).toContain('element: "インベントリ（7）"\n    direction: DOWN\n    centerElement: true');
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
