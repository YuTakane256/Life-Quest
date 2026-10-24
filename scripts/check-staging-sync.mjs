import { pathToFileURL } from 'node:url';

const clientKeys = ['VITE_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];
const notVerified = [
    '指定したプロジェクトが本番とは別の検証専用環境であること（管理者の確認が必要）',
    'キーの署名・有効性、通信、Auth、DB/RLS/Edgeのデプロイ状態',
    '起動したWeb/Mobileの実接続先、保存領域の分離、双方向同期・オフライン・再起動',
];

function jwtPayload(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
    try {
        const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
        return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    } catch { return null; }
}

function isClientKey(value, projectRef) {
    if (typeof value !== 'string' || value.trim() !== value) return false;
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
    const payload = jwtPayload(value);
    // Decoding is a configuration check, NOT signature/authenticity verification.
    return payload?.role === 'anon' && payload.ref === projectRef;
}

function matchesProject(value, projectRef) {
    if (typeof value !== 'string' || value.trim() !== value || !/^[a-z0-9]{20}$/.test(projectRef ?? '')) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === `${projectRef}.supabase.co`
            && !url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
    } catch { return false; }
}

/** Read-only, offline inspection of the supplied process environment; never discovers credentials or contacts Supabase. */
export function inspectStagingSyncEnvironment(env) {
    const checks = [];
    const check = (id, passed, message) => checks.push({ id, status: passed ? 'pass' : 'fail', message });
    const ref = env.LIFE_QUEST_STAGING_PROJECT_REF;
    check('target-declaration', env.LIFE_QUEST_SYNC_TARGET === 'staging',
        'LIFE_QUEST_SYNC_TARGET=staging: 管理者が検証専用と確認してから宣言する');
    check('project-reference', typeof ref === 'string' && /^[a-z0-9]{20}$/.test(ref),
        'LIFE_QUEST_STAGING_PROJECT_REF: 管理者が確認した検証用project refを指定する');
    check('web-project', matchesProject(env.VITE_SUPABASE_URL, ref),
        'VITE_SUPABASE_URL: 指定refのSupabase HTTPSルートと一致する');
    check('mobile-project', matchesProject(env.EXPO_PUBLIC_SUPABASE_URL, ref),
        'EXPO_PUBLIC_SUPABASE_URL: Webと同じ指定refのSupabase HTTPSルートと一致する');
    for (const key of clientKeys) check(key, isClientKey(env[key], ref),
        `${key}: publishableキー、または指定refのrole=anon JWTを使用する（真正性は未検証）`);
    check('same-client-key', Boolean(env[clientKeys[0]]) && env[clientKeys[0]] === env[clientKeys[1]],
        'この確認手順ではWeb/Mobileへ同じ公開クライアントキーを設定する');
    const unsafe = Object.entries(env).some(([name, value]) => /^(VITE_|EXPO_PUBLIC_)/.test(name)
        && typeof value === 'string' && (/sb_secret_|-----BEGIN[^\r\n]*PRIVATE KEY/i.test(value) || jwtPayload(value)?.role === 'service_role'));
    check('public-values', !unsafe, 'VITE_*/EXPO_PUBLIC_*にサーバー専用キー・秘密鍵を渡さない');
    check('native-identity', env.LIFE_QUEST_APP_VARIANT === 'parity',
        'LIFE_QUEST_APP_VARIANT=parity: release/previewと分離した開発アプリを使う');
    check('no-fixture', !env.LIFE_QUEST_PARITY_CAPTURE && !env.LIFE_QUEST_PARITY_PROFILE,
        'LIFE_QUEST_PARITY_CAPTURE/PROFILE: 比較用メモリfixtureを無効にする');
    check('explicit-mobile-env', env.EXPO_NO_DOTENV === '1',
        'EXPO_NO_DOTENV=1: Mobileで別の.envを自動読込しない');
    check('mobile-client-env', !env.EXPO_NO_CLIENT_ENV_VARS || ['0', 'false'].includes(env.EXPO_NO_CLIENT_ENV_VARS),
        'EXPO_NO_CLIENT_ENV_VARS: 公開接続設定のアプリへの組込みを無効にしない');
    return {
        scope: 'configuration-only',
        status: checks.every((item) => item.status === 'pass') ? 'configuration-consistent' : 'blocked',
        checks,
        notVerified: [...notVerified],
    };
}

const usage = '使い方: npm run sync:staging:check -- [--json]（現在のprocess.envだけを診断。接続・ログイン・データ変更なし）';

export function runStagingSyncCheck(args, env, write = console.log) {
    if (args.length === 1 && args[0] === '--help') { write(usage); return 0; }
    if (args.length > 1 || (args.length && args[0] !== '--json')) { write(usage); return 1; }
    const result = inspectStagingSyncEnvironment(env);
    if (args[0] === '--json') write(JSON.stringify(result, null, 2));
    else {
        write(`[staging sync] ${result.status} — 設定の整合性のみ。接続・同期は未検証です。`);
        for (const item of result.checks) write(`[${item.status === 'pass' ? 'OK' : '不足/不一致'}] ${item.message}`);
        for (const item of result.notVerified) write(`[未確認] ${item}`);
        write('接続先やキーの値は表示していません。手順: docs/staging-sync-acceptance.md');
    }
    return result.status === 'configuration-consistent' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = runStagingSyncCheck(process.argv.slice(2), process.env);
}
