// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertPublicMobileEnvironment } from './public-client-environment.cjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const mobile = fileURLToPath(new URL('../apps/mobile', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/expo/bin/cli', import.meta.url));
const token = (role) => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ role })).toString('base64url'), 'syntheticSignature'].join('.');
function env(extra) {
    const values = { ...process.env, EXPO_NO_DOTENV: '1', EXPO_OFFLINE: '1', CI: '1' };
    for (const key of Object.keys(values)) if (key.startsWith('EXPO_PUBLIC_')) delete values[key];
    return { ...values, ...extra };
}
function config(environment, cwd = mobile) {
    return spawnSync(process.execPath, [cli, 'config', '--type', 'public', '--json'], { cwd, env: env(environment), encoding: 'utf8', timeout: 30_000 });
}

describe('actual Expo public configuration rejects server credentials', () => {
    it.each(['release', 'preview', 'parity'])('%s refuses a privileged key without printing it', (variant) => {
        const secret = token('service_role');
        const result = config({ LIFE_QUEST_APP_VARIANT: variant, EXPO_PUBLIC_SUPABASE_ANON_KEY: secret });
        expect(result.error).toBeUndefined(); expect(result.signal).toBeNull();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('value hidden');
        expect(result.stdout + result.stderr).not.toContain(secret);
    }, 35_000);
});


const fixtures = [];
afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
const serverFixtures = [
    { name: 'service role JWT', value: token('service_role') },
    { name: 'legacy payload check', value: `header.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature` },
    { name: 'secret key', value: 'sb_secret_syntheticOnlyNotReal' },
    { name: 'conservative prefix', value: 'SB_SECRET_' },
    ...['', 'RSA ', 'EC ', 'OPENSSH '].map((kind) => ({ name: `${kind}private key`, value: `-----BEGIN ${kind}PRIVATE KEY-----\nsynthetic-only\n-----END ${kind}PRIVATE KEY-----` })),
];
describe('public Mobile environment policy', () => {
    it.each(serverFixtures)('rejects $name anywhere in the public namespace without echoing values or names', ({ value }) => {
        let failure;
        try { assertPublicMobileEnvironment({ EXPO_PUBLIC_ARBITRARY_SETTING: `prefix ${value} suffix` }); } catch (error) { failure = error; }
        expect(failure).toBeInstanceOf(Error);
        expect(failure.message).toBe('Public mobile environment contains a server-only credential: sb_secret_*, JWT role=service_role or private key (value hidden).');
        expect(failure.message).not.toContain(value); expect(failure.message).not.toContain('EXPO_PUBLIC_ARBITRARY_SETTING');
    });
    it('allows absent/public settings and private server environment without claiming credential validity', () => {
        expect(() => assertPublicMobileEnvironment({
            EXPO_PUBLIC_SUPABASE_ANON_KEY: token('anon'), EXPO_PUBLIC_NEW_KEY: 'sb_publishable_syntheticOnly',
            EXPO_PUBLIC_FEATURE_FLAG: 'enabled', EXPO_PUBLIC_OPTIONAL: undefined, SERVER_ONLY_KEY: token('service_role'),
        })).not.toThrow();
        expect(() => assertPublicMobileEnvironment({})).not.toThrow();
    });
    it('actual Expo config keeps all safe identities, including anonymous parity', () => {
        for (const variant of ['release', 'preview', 'parity']) {
            const result = config({ LIFE_QUEST_APP_VARIANT: variant, EXPO_PUBLIC_SUPABASE_ANON_KEY: variant === 'parity' ? '' : 'sb_publishable_syntheticOnly' });
            expect(result.error).toBeUndefined(); expect(result.status).toBe(0);
            const output = JSON.parse(result.stdout);
            expect(output.extra.appVariant).toBe(variant);
            expect(output.ios.bundleIdentifier).toBe(`com.yutakane.lifequest${variant === 'release' ? '' : `.${variant}`}`);
            expect(output.extra.parityLocalOnly).toBe(variant === 'parity');
        }
    }, 35_000);
    it('actual Expo export refuses a private key before writing any bundle', () => {
        const output = mkdtempSync(join(tmpdir(), 'lifequest-expo-guard-export-')); fixtures.push(output);
        const secret = '-----BEGIN PRIVATE KEY-----\nsynthetic-only\n-----END PRIVATE KEY-----';
        const result = spawnSync(process.execPath, [cli, 'export', '--platform', 'ios', '--output-dir', join(output, 'dist')], {
            cwd: mobile, env: env({ LIFE_QUEST_APP_VARIANT: 'parity', EXPO_PUBLIC_OTHER: secret }), encoding: 'utf8', timeout: 30_000,
        });
        expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('value hidden'); expect(result.stdout + result.stderr).not.toContain(secret);
        expect(existsSync(join(output, 'dist'))).toBe(false);
    }, 35_000);
    it('actual Expo dotenv loading also reaches the guard in an isolated project', () => {
        const project = mkdtempSync(join(tmpdir(), 'lifequest-expo-guard-dotenv-')); fixtures.push(project);
        symlinkSync(join(root, 'node_modules'), join(project, 'node_modules'), 'dir');
        writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'guard-fixture', version: '1.0.0' }));
        const helper = fileURLToPath(new URL('./public-client-environment.cjs', import.meta.url));
        writeFileSync(join(project, 'app.config.js'), `const {assertPublicMobileEnvironment} = require(${JSON.stringify(helper)}); module.exports = () => { assertPublicMobileEnvironment(process.env); return { name: 'guard-fixture', slug: 'guard-fixture' }; };`);
        const secret = token('service_role');
        writeFileSync(join(project, '.env'), `EXPO_PUBLIC_SUPABASE_ANON_KEY=${secret}\n`);
        const result = config({ EXPO_NO_DOTENV: '0' }, project);
        expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('value hidden'); expect(result.stdout + result.stderr).not.toContain(secret);
    }, 35_000);
});
