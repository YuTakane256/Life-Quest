import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { stagingLaunchPlan } from './run-staging-sync.mjs';

export const STAGING_HEALTH_TIMEOUT_MS = 8000;
const notVerified = [
    'プロジェクトの停止理由・停止予定・復帰期限（Supabaseダッシュボードで確認）',
    'DB/RLS/Edge・ログイン・双方向同期・端末の動作',
];
const messages = {
    'configuration-blocked': '専用設定を確認してください。通信していません。',
    'auth-endpoint-reachable': 'Authのhealth endpointがHTTP 200を返しました。',
    'access-rejected': '公開キーまたは接続先を確認してください。',
    unavailable: '接続できません。通信状態とダッシュボードの稼働状態を確認してください。停止とは断定しません。',
    'timed-out': '接続確認が時間内に終わりませんでした。通信状態とダッシュボードを確認してください。',
};
const result = (status, httpStatus = null) => ({
    scope: 'staging-auth-endpoint-only', status, httpStatus, message: messages[status], notVerified: [...notVerified],
});

/** A single read-only request, validated with the same dedicated settings as the staging launcher. */
export async function inspectStagingHealth(settings, { fetchFn = globalThis.fetch } = {}) {
    let env;
    try { env = stagingLaunchPlan('web', settings, {}).env; }
    catch { return result('configuration-blocked'); }
    const controller = new AbortController();
    let timer;
    const timedOut = new Promise((resolve) => {
        timer = setTimeout(() => {
            resolve(result('timed-out'));
            controller.abort();
        }, STAGING_HEALTH_TIMEOUT_MS);
    });
    const request = Promise.resolve().then(() => fetchFn(new URL('/auth/v1/health', env.VITE_SUPABASE_URL), {
        method: 'GET', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Accept: 'application/json' },
        redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
    })).then((response) => {
        // Never read, retain, or print the body (including proxy/server error details).
        try { void response.body?.cancel().catch(() => {}); } catch { /* An already-closed body needs no action. */ }
        const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
        return result(status === 200 ? 'auth-endpoint-reachable'
            : status === 401 || status === 403 ? 'access-rejected' : 'unavailable', status);
    }).catch(() => result('unavailable'));
    try { return await Promise.race([request, timedOut]); }
    finally { clearTimeout(timer); controller.abort(); }
}

const usage = '使い方: npm run sync:staging:health -- [--json]（.staging-sync.localだけを使い、Auth healthへGETを1回。ログイン・データ変更・自動復帰なし）';
export async function runStagingHealthCheck(args, {
    readSettings = () => parseEnv(readFileSync(new URL('../.staging-sync.local', import.meta.url), 'utf8')),
    fetchFn = globalThis.fetch, write = console.log,
} = {}) {
    if (args.length === 1 && args[0] === '--help') { write(usage); return 0; }
    if (args.length > 1 || (args.length && args[0] !== '--json')) { write(usage); return 1; }
    let report;
    try { report = await inspectStagingHealth(readSettings(), { fetchFn }); }
    catch { report = result('configuration-blocked'); }
    if (args[0] === '--json') write(JSON.stringify(report, null, 2));
    else {
        write(`[staging health] ${report.status} — ${report.message}`);
        for (const item of report.notVerified) write(`[未確認] ${item}`);
        write('接続先・キー・レスポンス本文は表示していません。手順: docs/staging-project-availability.md');
    }
    return report.status === 'auth-endpoint-reachable' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await runStagingHealthCheck(process.argv.slice(2));
}
