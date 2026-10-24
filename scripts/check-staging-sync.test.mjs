// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { inspectStagingSyncEnvironment, runStagingSyncCheck } from './check-staging-sync.mjs';

const ref = 'abcdefghijklmnopqrst';
const otherRef = 'zyxwvutsrqponmlkjihg';
const jwt = (payload) => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fake-signature`;
const valid = () => ({
    LIFE_QUEST_SYNC_TARGET: 'staging', LIFE_QUEST_STAGING_PROJECT_REF: ref,
    VITE_SUPABASE_URL: `https://${ref}.supabase.co`, EXPO_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co/`,
    VITE_SUPABASE_ANON_KEY: 'sb_publishable_fake_for_offline_test', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fake_for_offline_test',
    LIFE_QUEST_APP_VARIANT: 'parity', LIFE_QUEST_PARITY_CAPTURE: '', LIFE_QUEST_PARITY_PROFILE: '', EXPO_NO_DOTENV: '1',
});
const failed = (env, id) => expect(inspectStagingSyncEnvironment(env).checks.find((check) => check.id === id)?.status).toBe('fail');

describe('staging同期の非接続事前診断', () => {
    it('設定一致を実同期の成功と呼ばず、通信も行わない', () => {
        const fetch = vi.spyOn(globalThis, 'fetch');
        try {
            const result = inspectStagingSyncEnvironment(valid());
            expect(result.status).toBe('configuration-consistent'); expect(result.scope).toBe('configuration-only');
            expect(result.notVerified).toHaveLength(3); expect(fetch).not.toHaveBeenCalled();
        } finally { fetch.mockRestore(); }
    });
    it('未設定をskip成功にせず、不足項目を返す', () => {
        expect(inspectStagingSyncEnvironment({}).status).toBe('blocked');
        const write = vi.fn(); expect(runStagingSyncCheck([], {}, write)).toBe(1);
        expect(write.mock.calls.flat().join('\n')).toContain('不足/不一致');
    });
    it.each(['LIFE_QUEST_SYNC_TARGET', 'LIFE_QUEST_STAGING_PROJECT_REF', 'VITE_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL',
        'VITE_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'LIFE_QUEST_APP_VARIANT', 'EXPO_NO_DOTENV'])('%sの不足を拒否する', (key) => {
        expect(inspectStagingSyncEnvironment({ ...valid(), [key]: '' }).status).toBe('blocked');
    });
    it.each(['production', 'local', ' staging'])('対象宣言%sを拒否する', (value) => failed({ ...valid(), LIFE_QUEST_SYNC_TARGET: value }, 'target-declaration'));
    it.each(['', 'REF', `${ref} `, 'https://secret.example.com'])('不正なrefを拒否する: %s', (value) => failed({ ...valid(), LIFE_QUEST_STAGING_PROJECT_REF: value }, 'project-reference'));
    it.each(['VITE_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL'])('%sの別接続先や余分なURL成分を拒否する', (key) => {
        for (const value of [`https://${otherRef}.supabase.co`, `http://${ref}.supabase.co`, `https://${ref}.supabase.co.evil.test`,
            'http://127.0.0.1:55321', `https://user:secret@${ref}.supabase.co`, `https://${ref}.supabase.co:8443`,
            `https://${ref}.supabase.co/auth/v1`, `https://${ref}.supabase.co?key=secret`, `https://${ref}.supabase.co#secret`, 'bad-secret-url', ` https://${ref}.supabase.co`]) {
            failed({ ...valid(), [key]: value }, key === 'VITE_SUPABASE_URL' ? 'web-project' : 'mobile-project');
        }
    });
    it('公開JWTはanonかつ指定refだけを許可し、署名検証済みとはしない', () => {
        const key = jwt({ role: 'anon', ref });
        expect(inspectStagingSyncEnvironment({ ...valid(), VITE_SUPABASE_ANON_KEY: key, EXPO_PUBLIC_SUPABASE_ANON_KEY: key }).status).toBe('configuration-consistent');
    });
    it.each(['VITE_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'])('%sの秘密キー・他プロジェクト・不正形式を拒否する', (name) => {
        for (const value of ['sb_secret_sensitive-sentinel', jwt({ role: 'service_role', ref }), jwt({ role: 'authenticated', ref }),
            jwt({ role: 'anon', ref: otherRef }), jwt({ role: 'anon' }), 'bad-sensitive-sentinel', 'e30.bad-json.signature', 'sb_publishable_', ' sb_publishable_fake', 'sb_publishable_fake\n']) {
            failed({ ...valid(), [name]: value }, name);
        }
    });
    it('この手順では公開キーのコピー違いも止める', () => failed({ ...valid(), EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_other' }, 'same-client-key'));
    it.each(['VITE_UNUSED', 'EXPO_PUBLIC_UNUSED'])('他の公開変数%sへの秘密値混入も止める', (name) => {
        for (const value of ['sb_secret_sensitive-sentinel', jwt({ role: 'service_role', ref }), '-----BEGIN PRIVATE KEY-----\nsensitive-sentinel']) failed({ ...valid(), [name]: value }, 'public-values');
    });
    it.each(['release', 'preview', ' parity'])('通常版/preview/誤指定%sを拒否する', (value) => failed({ ...valid(), LIFE_QUEST_APP_VARIANT: value }, 'native-identity'));
    it.each(['LIFE_QUEST_PARITY_CAPTURE', 'LIFE_QUEST_PARITY_PROFILE'])('%sの比較fixtureを拒否する', (name) => failed({ ...valid(), [name]: 'daily' }, 'no-fixture'));
    it.each(['1', 'true', 'invalid'])('公開接続設定の組込み無効化%sを拒否する', (value) => failed({ ...valid(), EXPO_NO_CLIENT_ENV_VARS: value }, 'mobile-client-env'));
    it('有効なキーの形式であってもキーや接続先の値を出力しない', () => {
        for (const args of [[], ['--json']]) {
            const write = vi.fn(); expect(runStagingSyncCheck(args, valid(), write)).toBe(0);
            const output = write.mock.calls.flat().join('\n');
            expect(output).not.toContain(ref); expect(output).not.toContain('sb_publishable_fake_for_offline_test');
            expect(output).toContain('configuration');
        }
    });
    it('失敗時もURL・秘密値・不正引数を出力しない', () => {
        for (const args of [[], ['--json'], ['--sensitive-sentinel'], ['--json', 'sensitive-sentinel']]) {
            const write = vi.fn();
            expect(runStagingSyncCheck(args, { ...valid(), VITE_SUPABASE_URL: 'https://sensitive-sentinel.test', VITE_SUPABASE_ANON_KEY: 'sb_secret_sensitive-sentinel' }, write)).toBe(1);
            expect(write.mock.calls.flat().join('\n')).not.toContain('sensitive-sentinel');
        }
    });
    it('CLIの終了コード/JSONも不足と整合性を区別する（外部接続なし）', () => {
        const script = fileURLToPath(new URL('./check-staging-sync.mjs', import.meta.url));
        for (const env of [{}, valid()]) {
            const result = spawnSync(process.execPath, [script, '--json'], { env, encoding: 'utf8' });
            expect(result.status).toBe(Object.keys(env).length ? 0 : 1); expect(result.stderr).toBe('');
            expect(JSON.parse(result.stdout).status).toBe(Object.keys(env).length ? 'configuration-consistent' : 'blocked');
        }
    });
    it('helpは検証成功を出さない', () => {
        const write = vi.fn(); expect(runStagingSyncCheck(['--help'], {}, write)).toBe(0);
        expect(write.mock.calls.flat().join('\n')).not.toContain('configuration-consistent');
    });
});
