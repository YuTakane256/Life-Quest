import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectStagingSyncEnvironment } from './check-staging-sync.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const settingsPath = new URL('../.staging-sync.local', import.meta.url);
const allowedKeys = new Set([
    'LIFE_QUEST_SYNC_TARGET', 'LIFE_QUEST_STAGING_PROJECT_REF',
    'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'LIFE_QUEST_APP_VARIANT', 'LIFE_QUEST_PARITY_CAPTURE', 'LIFE_QUEST_PARITY_PROFILE',
    'EXPO_NO_DOTENV', 'EXPO_NO_CLIENT_ENV_VARS',
]);

/** Only the dedicated file supplies client settings; inherited public/DB settings never reach the child. */
export function stagingLaunchPlan(target, settings, inherited = {}) {
    if (!['web', 'web-preview', 'mobile'].includes(target)) throw new Error('起動対象が不正です。');
    if (Object.keys(settings).some((key) => !allowedKeys.has(key))) {
        throw new Error('専用設定に許可していない変数があります。公開接続設定だけを指定してください（値は非表示）。');
    }
    if (inspectStagingSyncEnvironment(settings).status !== 'configuration-consistent') {
        throw new Error('専用設定が不足または不一致です。staging同期の事前診断を確認してください（値は非表示）。');
    }
    const env = Object.fromEntries(Object.entries(inherited)
        .filter(([key]) => !/^(VITE_|EXPO_|LIFE_QUEST_|SUPABASE_)/.test(key)));
    Object.assign(env, settings);
    if (target === 'web' || target === 'web-preview') return {
        cwd: root, env, port: target === 'web' ? 4175 : 4176,
        args: [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
            ...(target === 'web-preview' ? ['preview'] : []),
            '--config', fileURLToPath(new URL('../vite.staging.config.ts', import.meta.url)),
            '--host', '127.0.0.1', '--port', target === 'web' ? '4175' : '4176', '--strictPort'],
    };
    // Expo must fail rather than interactively choosing another port.
    env.CI = '1';
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --dns-result-order=ipv4first`.trim();
    return {
        cwd: fileURLToPath(new URL('../apps/mobile', import.meta.url)), env, port: 8083,
        args: [fileURLToPath(new URL('../node_modules/expo/bin/cli', import.meta.url)),
            'start', '--dev-client', '--localhost', '--port', '8083'],
    };
}

export function assertStagingPortAvailable(port) {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', () => reject(new Error('専用ポートを使用できません。既存サーバーを確認してください。別ポートでは起動しません。')));
        server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve));
    });
}

function startServer(plan, { signal } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { resolve(130); return; }
        const child = spawn(process.execPath, plan.args, { cwd: plan.cwd, env: plan.env, stdio: 'inherit' });
        const interrupt = () => child.kill(signal.reason === 'SIGTERM' ? 'SIGTERM' : 'SIGINT');
        signal?.addEventListener('abort', interrupt, { once: true });
        const cleanup = () => signal?.removeEventListener('abort', interrupt);
        child.once('error', () => { cleanup(); reject(new Error('開発サーバーを起動できませんでした。')); });
        child.once('close', (code, signal) => { cleanup(); resolve(code ?? (signal === 'SIGINT' ? 130 : 1)); });
    });
}

export async function runStagingSync(args, inherited, {
    readSettings = () => parseEnv(readFileSync(settingsPath, 'utf8')),
    checkPort = assertStagingPortAvailable,
    execute = startServer,
    write = console.log,
    signal,
} = {}) {
    if (args.length !== 1 || !['web', 'web-preview', 'mobile'].includes(args[0])) {
        write('使い方: npm run sync:staging:web / sync:staging:web:preview / sync:staging:mobile');
        return 1;
    }
    let plan;
    try { plan = stagingLaunchPlan(args[0], readSettings(), inherited); }
    catch {
        write('起動を中止しました。.staging-sync.localの公開接続設定を見本と事前診断で確認してください。値は表示していません。');
        return 1;
    }
    const controller = new AbortController();
    const interrupt = () => controller.abort('SIGINT');
    const terminate = () => controller.abort('SIGTERM');
    const relayAbort = () => controller.abort(signal.reason);
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    signal?.addEventListener('abort', relayAbort, { once: true });
    if (signal?.aborted) relayAbort();
    const cancelledCode = () => controller.signal.reason === 'SIGTERM' ? 143 : 130;
    let ownedDirectory;
    try {
        if (controller.signal.aborted) return cancelledCode();
        await checkPort(plan.port);
        if (controller.signal.aborted) return cancelledCode();
        if (args[0] === 'web-preview') {
            // Never build into, serve, empty, or remove the normal dist directory.
            ownedDirectory = await mkdtemp(join(tmpdir(), 'life-quest-staging-preview-'));
            if (controller.signal.aborted) return cancelledCode();
            write('[staging sync] 専用の一時ディレクトリへWeb PWAをビルドします。');
            const buildCode = await execute({ ...plan, args: [plan.args[0], 'build',
                '--config', fileURLToPath(new URL('../vite.staging.config.ts', import.meta.url)),
                '--outDir', ownedDirectory,
            ] }, { signal: controller.signal });
            if (controller.signal.aborted) return cancelledCode();
            if (buildCode !== 0) return buildCode;
            plan = { ...plan, args: [...plan.args, '--outDir', ownedDirectory] };
        }
        write(`[staging sync] ${args[0]} / localhost:${plan.port} — 接続・保存領域・同期の成功は起動後に確認してください。`);
        const code = await execute(plan, { signal: controller.signal });
        return controller.signal.aborted ? cancelledCode() : code;
    } catch {
        write('起動を中止しました。専用ポート・依存関係を確認してください。既存プロセスの停止やポート変更は行っていません。');
        return 1;
    } finally {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', terminate);
        signal?.removeEventListener('abort', relayAbort);
        if (ownedDirectory) await rm(ownedDirectory, { recursive: true, force: true });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await runStagingSync(process.argv.slice(2), process.env);
}
