// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectStagingHealth, runStagingHealthCheck, STAGING_HEALTH_TIMEOUT_MS } from './check-staging-health.mjs';

const ref = 'abcdefghijklmnopqrst';
const sentinel = 'private-sentinel';
const valid = () => ({
    LIFE_QUEST_SYNC_TARGET: 'staging', LIFE_QUEST_STAGING_PROJECT_REF: ref,
    VITE_SUPABASE_URL: `https://${ref}.supabase.co`, EXPO_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: 'sb_publishable_fake_for_test', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fake_for_test',
    LIFE_QUEST_APP_VARIANT: 'parity', EXPO_NO_DOTENV: '1',
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('stagingの単発・非変更health確認', () => {
    it('専用設定のAuth healthだけへGETを1回行い、Cookie/認証トークン/redirectを使わない', async () => {
        const fetchFn = vi.fn(async () => new Response(sentinel, { status: 200 }));
        const report = await inspectStagingHealth(valid(), { fetchFn });
        expect(report).toMatchObject({ status: 'auth-endpoint-reachable', httpStatus: 200, scope: 'staging-auth-endpoint-only' });
        expect(report.notVerified.join(' ')).toContain('DB/RLS/Edge');
        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [url, options] = fetchFn.mock.calls[0];
        expect(String(url)).toBe(`https://${ref}.supabase.co/auth/v1/health`);
        expect(options).toMatchObject({ method: 'GET', headers: { apikey: valid().VITE_SUPABASE_ANON_KEY }, redirect: 'error', credentials: 'omit', cache: 'no-store' });
        expect(options.headers).not.toHaveProperty('Authorization'); expect(options).not.toHaveProperty('body');
        expect(options.signal.aborted).toBe(true); // Network/body resources are released on completion.
        expect(JSON.stringify(report)).not.toContain(sentinel);
    });
    it.each([
        {}, { ...valid(), LIFE_QUEST_SYNC_TARGET: 'production' },
        { ...valid(), VITE_SUPABASE_URL: 'https://private-sentinel.test' },
        { ...valid(), VITE_SUPABASE_ANON_KEY: 'sb_secret_private-sentinel' },
        { ...valid(), LIFE_QUEST_PARITY_PROFILE: 'daily' },
        { ...valid(), SUPABASE_SERVICE_ROLE_KEY: sentinel },
    ])('不足・他接続先・秘密値・fixtureは通信前に拒否する', async (settings) => {
        const fetchFn = vi.fn(); const report = await inspectStagingHealth(settings, { fetchFn });
        expect(report.status).toBe('configuration-blocked'); expect(fetchFn).not.toHaveBeenCalled();
        expect(JSON.stringify(report)).not.toContain(sentinel);
    });
    it.each([204, 301, 401, 403, 404, 429, 500, 503])('HTTP %sでも本文を読み取らず、503を停止と断定せず再試行しない', async (status) => {
        const body = { cancel: vi.fn(async () => {}) };
        const text = vi.fn(() => { throw new Error(sentinel); }); const json = vi.fn(() => { throw new Error(sentinel); });
        const fetchFn = vi.fn(async () => ({ status, body, text, json }));
        const report = await inspectStagingHealth(valid(), { fetchFn });
        expect(report.status).toBe([401, 403].includes(status) ? 'access-rejected' : 'unavailable');
        expect(report.httpStatus).toBe(status); expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(text).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled(); expect(body.cancel).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(report)).not.toContain(sentinel); expect(report.status).not.toBe('paused');
    });
    it('DNS/TLS/redirect例外も生の診断やURLを出さず、再試行しない', async () => {
        const fetchFn = vi.fn(async () => { throw new Error(`https://${sentinel}.test token=${sentinel}`); });
        const report = await inspectStagingHealth(valid(), { fetchFn });
        expect(report.status).toBe('unavailable'); expect(fetchFn).toHaveBeenCalledTimes(1); expect(JSON.stringify(report)).not.toContain(sentinel);
    });
    it('応答が返らない・abortを無視する通信でも8秒で終了し、後着の成功へ結果を変えない', async () => {
        vi.useFakeTimers(); let finish;
        const fetchFn = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        const pending = inspectStagingHealth(valid(), { fetchFn }); await Promise.resolve();
        await vi.advanceTimersByTimeAsync(STAGING_HEALTH_TIMEOUT_MS);
        const report = await pending;
        expect(report.status).toBe('timed-out'); expect(fetchFn.mock.calls[0][1].signal.aborted).toBe(true);
        finish(new Response('later', { status: 200 })); await Promise.resolve();
        expect(report.status).toBe('timed-out'); expect(vi.getTimerCount()).toBe(0);
    });
    it('health応答後の本文cancelを待ち続けない', async () => {
        const fetchFn = vi.fn(async () => ({ status: 200, body: { cancel: () => new Promise(() => {}) } }));
        expect((await inspectStagingHealth(valid(), { fetchFn })).status).toBe('auth-endpoint-reachable');
    });
    it.each([{ args: [] }, { args: ['--json'] }])('出力は値を伏せ、専用ファイルだけを読み取る: $args', async ({ args }) => {
        const readSettings = vi.fn(valid); const fetchFn = vi.fn(async () => new Response(sentinel, { status: 200 })); const write = vi.fn();
        expect(await runStagingHealthCheck(args, { readSettings, fetchFn, write })).toBe(0);
        expect(readSettings).toHaveBeenCalledTimes(1);
        const output = write.mock.calls.flat().join('\n');
        for (const value of [ref, valid().VITE_SUPABASE_ANON_KEY, sentinel]) expect(output).not.toContain(value);
        expect(output).toContain('auth-endpoint-reachable');
    });
    it('ファイル読込の例外を表示せず、通信せずに終了する', async () => {
        const fetchFn = vi.fn(); const write = vi.fn();
        expect(await runStagingHealthCheck(['--json'], { readSettings: () => { throw new Error(sentinel); }, fetchFn, write })).toBe(1);
        expect(fetchFn).not.toHaveBeenCalled(); expect(JSON.parse(write.mock.calls[0][0]).status).toBe('configuration-blocked');
        expect(write.mock.calls.flat().join(' ')).not.toContain(sentinel);
    });
    it.each([{ args: ['--help'] }, { args: ['--private-sentinel'] }, { args: ['--json', 'private-sentinel'] }])('help/不正引数では設定も通信も触らない: $args', async ({ args }) => {
        const readSettings = vi.fn(); const fetchFn = vi.fn(); const write = vi.fn();
        expect(await runStagingHealthCheck(args, { readSettings, fetchFn, write })).toBe(args[0] === '--help' ? 0 : 1);
        expect(readSettings).not.toHaveBeenCalled(); expect(fetchFn).not.toHaveBeenCalled();
        expect(write.mock.calls.flat().join(' ')).not.toContain(sentinel);
    });
    it.each([401, 503])('CLIはHTTP %sを成功扱いせず、JSONにも本文を転記しない', async (status) => {
        const write = vi.fn(); const fetchFn = vi.fn(async () => new Response(sentinel, { status }));
        expect(await runStagingHealthCheck(['--json'], { readSettings: valid, fetchFn, write })).toBe(1);
        const output = write.mock.calls[0][0]; expect(JSON.parse(output).httpStatus).toBe(status);
        expect(output).not.toContain(sentinel); expect(output).not.toContain(ref);
    });
    it('継承した公開設定や管理者キーを専用設定へ混ぜない', async () => {
        vi.stubEnv('VITE_SUPABASE_URL', 'https://private-sentinel.test');
        vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_secret_private-sentinel');
        vi.stubEnv('SUPABASE_ACCESS_TOKEN', sentinel);
        const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
        expect(await runStagingHealthCheck([], { readSettings: valid, fetchFn, write: () => {} })).toBe(0);
        const [url, options] = fetchFn.mock.calls[0];
        expect(String(url)).toBe(`https://${ref}.supabase.co/auth/v1/health`);
        expect(options.headers.apikey).toBe(valid().VITE_SUPABASE_ANON_KEY);
        expect(JSON.stringify(options.headers)).not.toContain(sentinel);
    });

});
