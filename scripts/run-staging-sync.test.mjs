// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runStagingSync, stagingLaunchPlan } from './run-staging-sync.mjs';

const ref = 'abcdefghijklmnopqrst';
const settings = () => ({
    LIFE_QUEST_SYNC_TARGET: 'staging', LIFE_QUEST_STAGING_PROJECT_REF: ref,
    VITE_SUPABASE_URL: `https://${ref}.supabase.co`, EXPO_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: 'sb_publishable_fake', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fake',
    LIFE_QUEST_APP_VARIANT: 'parity', LIFE_QUEST_PARITY_CAPTURE: '', LIFE_QUEST_PARITY_PROFILE: '',
    EXPO_NO_DOTENV: '1', EXPO_NO_CLIENT_ENV_VARS: '0',
});

describe('専用staging起動', () => {
    it.each(['web', 'web-preview', 'mobile'])('%sは継承した公開設定・fixture・管理者キーを渡さず、専用ファイルを使う', (target) => {
        const plan = stagingLaunchPlan(target, settings(), {
            PATH: '/usr/bin', HOME: '/home/test',
            VITE_SUPABASE_URL: 'https://wrong.example.com', VITE_SECRET: 'sensitive-sentinel',
            EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_sensitive-sentinel', EXPO_PUBLIC_OTHER: 'sensitive-sentinel',
            EXPO_NO_CLIENT_ENV_VARS: '1', LIFE_QUEST_PARITY_CAPTURE: 'dark', LIFE_QUEST_PARITY_PROFILE: 'daily',
            SUPABASE_SERVICE_ROLE_KEY: 'sensitive-sentinel', SUPABASE_DB_URL: 'sensitive-sentinel',
        });
        expect(plan.env).toMatchObject(settings());
        expect(plan.env.PATH).toBe('/usr/bin');
        expect(JSON.stringify(plan.env)).not.toContain('sensitive-sentinel');
        expect(plan.port).toBe(target === 'mobile' ? 8083 : target === 'web' ? 4175 : 4176);
        if (target !== 'mobile') expect(plan.args).toContain('--strictPort');
        else {
            expect(plan.env.CI).toBe('1');
            expect(plan.args).toContain('--localhost');
            expect(plan.env.NODE_OPTIONS).toContain('--dns-result-order=ipv4first');
        }
    });

    it.each([
        { VITE_SUPABASE_URL: 'https://wrong.example.com' },
        { EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_sensitive-sentinel' },
        { LIFE_QUEST_PARITY_CAPTURE: 'dark' },
        { LIFE_QUEST_APP_VARIANT: 'release' },
        { EXPO_NO_DOTENV: '' },
        { SUPABASE_SERVICE_ROLE_KEY: 'sensitive-sentinel' },
        { NODE_OPTIONS: '--import=sensitive-sentinel' },
    ])('不正な専用設定ではサーバーもポート確認も開始しない', async (changes) => {
        const execute = vi.fn(); const checkPort = vi.fn(); const write = vi.fn();
        expect(await runStagingSync(['web'], {}, {
            readSettings: () => ({ ...settings(), ...changes }), execute, checkPort, write,
        })).toBe(1);
        expect(execute).not.toHaveBeenCalled(); expect(checkPort).not.toHaveBeenCalled();
        expect(JSON.stringify(write.mock.calls)).not.toContain('sensitive-sentinel');
        expect(JSON.stringify(write.mock.calls)).not.toContain('wrong.example.com');
    });

    it('設定ファイルの値を親環境の値で補完しない', async () => {
        const execute = vi.fn();
        expect(await runStagingSync(['web'], settings(), { readSettings: () => ({}), execute, write: vi.fn() })).toBe(1);
        expect(execute).not.toHaveBeenCalled();
    });

    it('使用中のポートなら止まり、既存サーバーを停止せず別ポートも選ばない', async () => {
        const execute = vi.fn(); const checkPort = vi.fn().mockRejectedValue(new Error('busy'));
        expect(await runStagingSync(['mobile'], {}, {
            readSettings: settings, execute, checkPort, write: vi.fn(),
        })).toBe(1);
        expect(checkPort).toHaveBeenCalledExactlyOnceWith(8083);
        expect(execute).not.toHaveBeenCalled();
    });

    it.each([[], ['production'], ['web', '--port', '5173']].map((args) => ({ args })))('不正な引数で設定読込・起動しない', async ({ args }) => {
        const readSettings = vi.fn(); const execute = vi.fn();
        expect(await runStagingSync(args, {}, { readSettings, execute, write: vi.fn() })).toBe(1);
        expect(readSettings).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    });

    it('読込エラーに含まれる値や設定内容を出力しない', async () => {
        const write = vi.fn(); const execute = vi.fn();
        expect(await runStagingSync(['web'], {}, {
            readSettings: () => { throw new Error('sensitive-sentinel'); }, execute, write,
        })).toBe(1);
        expect(JSON.stringify(write.mock.calls)).not.toContain('sensitive-sentinel');
        expect(execute).not.toHaveBeenCalled();
    });

    it('子サーバーの失敗を成功にしない。設定値は案内へ表示しない', async () => {
        const write = vi.fn();
        expect(await runStagingSync(['web'], {}, {
            readSettings: settings, checkPort: vi.fn(), execute: vi.fn().mockResolvedValue(7), write,
        })).toBe(7);
        const output = JSON.stringify(write.mock.calls);
        expect(output).not.toContain(ref); expect(output).not.toContain('sb_publishable_fake');
        expect(output).toContain('4175');
    });

    it('previewは専用ポート確認後、一時ビルドだけを配信し終了時に削除する', async () => {
        const checkPort = vi.fn(); let directory;
        const execute = vi.fn(async (plan) => {
            expect(checkPort).toHaveBeenCalledExactlyOnceWith(4176);
            const output = plan.args[plan.args.indexOf('--outDir') + 1];
            expect(output).not.toBe(join(plan.cwd, 'dist'));
            expect(plan.env).toMatchObject(settings());
            if (execute.mock.calls.length === 1) {
                directory = output;
                expect(plan.args[1]).toBe('build');
                expect(plan.args).toContain(join(plan.cwd, 'vite.staging.config.ts'));
                await writeFile(join(output, 'owned.txt'), 'only this build');
            } else {
                expect(plan.args[1]).toBe('preview');
                expect(output).toBe(directory);
                expect(plan.args).toContain('--strictPort');
                expect(await readFile(join(output, 'owned.txt'), 'utf8')).toBe('only this build');
            }
            return 0;
        });
        expect(await runStagingSync(['web-preview'], {}, { readSettings: settings, checkPort, execute, write: vi.fn() })).toBe(0);
        expect(execute).toHaveBeenCalledTimes(2);
        await expect(access(directory)).rejects.toThrow();
    });

    it.each(['failure', 'error', 'SIGINT', 'SIGTERM'])('ビルドの%s後はpreviewを開始せず、一時出力も残さない', async (failure) => {
        const controller = new AbortController(); let directory;
        const execute = vi.fn(async (plan) => {
            directory = plan.args[plan.args.indexOf('--outDir') + 1];
            await writeFile(join(directory, 'partial.txt'), 'partial');
            if (failure === 'error') throw new Error('sensitive-sentinel');
            if (failure.startsWith('SIG')) controller.abort(failure);
            return failure === 'failure' ? 7 : 0;
        });
        const write = vi.fn();
        const code = await runStagingSync(['web-preview'], {}, {
            readSettings: settings, checkPort: vi.fn(), execute, write, signal: controller.signal,
        });
        expect(code).toBe({ failure: 7, error: 1, SIGINT: 130, SIGTERM: 143 }[failure]);
        expect(execute).toHaveBeenCalledOnce();
        await expect(access(directory)).rejects.toThrow();
        expect(JSON.stringify(write.mock.calls)).not.toContain('sensitive-sentinel');
    });

    it('previewも不正設定・占有ポート・起動前キャンセルでビルドしない', async () => {
        for (const reason of ['settings', 'port', 'cancel']) {
            const controller = new AbortController(); if (reason === 'cancel') controller.abort();
            const execute = vi.fn();
            const code = await runStagingSync(['web-preview'], {}, {
                readSettings: () => reason === 'settings' ? {} : settings(),
                checkPort: async () => { if (reason === 'port') throw new Error('busy'); },
                execute, write: vi.fn(), signal: controller.signal,
            });
            expect(code).toBe(reason === 'cancel' ? 130 : 1);
            expect(execute).not.toHaveBeenCalled();
        }
    });
});
