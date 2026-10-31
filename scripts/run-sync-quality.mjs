import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const syncEnvironmentKeys = [
    'SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_FUNCTIONS_URL',
];
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** These suites create users and rows. Never run them against staging/production. */
export function assertLocalSyncEnvironment(env) {
    const missing = syncEnvironmentKeys.filter((key) => typeof env[key] !== 'string' || !env[key].trim());
    if (missing.length) throw new Error(`ローカルSupabaseの環境変数が不足しています: ${missing.join(', ')}。Docker/Supabaseを起動して設定してください。`);
    const parse = (key, protocols) => {
        let url;
        try { url = new URL(env[key]); } catch { throw new Error(`${key}のURLが不正です（値は非表示）。`); }
        if (!protocols.includes(url.protocol) || !loopbackHosts.has(url.hostname)) {
            throw new Error(`${key}はローカルのloopback URLだけを指定してください（値は非表示）。`);
        }
        return url;
    };
    const db = parse('SUPABASE_DB_URL', ['postgres:', 'postgresql:']);
    if (db.search || db.hash) throw new Error('SUPABASE_DB_URLの接続先を上書きしうるquery/fragmentは使用できません（値は非表示）。');
    const api = parse('SUPABASE_URL', ['http:', 'https:']);
    const functions = parse('SUPABASE_FUNCTIONS_URL', ['http:', 'https:']);
    if (api.username || api.password || api.pathname !== '/' || api.search || api.hash
        || functions.username || functions.password || functions.origin !== api.origin
        || !/^\/functions\/v1\/?$/.test(functions.pathname) || functions.search || functions.hash) {
        throw new Error('SUPABASE_URLとSUPABASE_FUNCTIONS_URLは同じローカルAPIのルートと/functions/v1を指定してください（値は非表示）。');
    }
}

const unitFiles = [
    'packages/core/src/cloudPull.test.ts',
    'packages/core/src/cloudCache.test.ts',
    'packages/core/src/cloudCacheValidation.test.ts',
    'packages/core/src/cloudCacheRestore.test.ts',
    'packages/core/src/cloudSyncState.test.ts',
    'packages/core/src/syncOutbox.test.ts',
    'packages/core/src/cloudOutboxSession.test.ts',
    'src/platform/cloudSyncSession.test.ts',
    'src/platform/cloudSyncRecoveryOrdering.test.ts',
    'src/components/ui/CloudSyncSettings.test.tsx',
    'src/platform/cloudOutboxTransport.test.ts',
    'src/platform/taskCompletionSession.test.ts',
    'src/hooks/inventoryNavigation.test.tsx',
    'src/hooks/chestNavigation.test.tsx',
    'apps/mobile/src/platform/cloudOutbox.test.ts',
    'apps/mobile/src/platform/networkRecovery.test.ts',
    'apps/mobile/src/platform/cloudSessionRecovery.test.ts',
];

export function syncQualityPlan(args, env) {
    if (args.length > 1 || (args.length && !['--unit', '--integration'].includes(args[0]))) {
        throw new Error('使い方: npm run test:sync -- [--unit | --integration]');
    }
    const integration = args[0] !== '--unit';
    if (integration) assertLocalSyncEnvironment(env); // Fail before any process/tests/users are started.
    const phases = [];
    if (args[0] !== '--integration') phases.push({ label: '同期・再送の境界回帰（モック/インメモリ）', files: [...unitFiles] });
    if (integration) phases.push({ label: 'ローカル実DB/Edge統合（端末UI・staging検証ではありません）', files: ['supabase/integration'] });
    return phases;
}

export function runSyncQuality(args, env, execute = spawnSync) {
    const phases = syncQualityPlan(args, env);
    const root = fileURLToPath(new URL('..', import.meta.url));
    const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
    for (const phase of phases) {
        console.log(`\n[sync quality] ${phase.label}`);
        const result = execute(process.execPath, [vitest, 'run', ...phase.files], { cwd: root, env, stdio: 'inherit' });
        if (result.error || result.signal) throw new Error('同期検証プロセスを正常に完了できませんでした。');
        if (result.status !== 0) return result.status ?? 1;
    }
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { process.exitCode = runSyncQuality(process.argv.slice(2), process.env); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
