// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkClientSecrets, containsServerCredential, findClientSecretViolations } from './check-service-role.mjs';
import { assertPublicSupabaseKey, supabaseCspPlugin } from './vite-supabase-csp';

// Synthetic unsigned fixtures, never real keys.
const token = (role) => [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role })).toString('base64url'), 'testsignature',
].join('.');
const admin = token('service_role');
const privateKey = '-----BEGIN PRIVATE KEY-----\nsynthetic-only\n-----END PRIVATE KEY-----';
const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('client credential prevention without leaking detected values', () => {
    it.each([admin, 'sb_secret_syntheticOnlyNotARealKey', privateKey])('rejects server credentials in source and public Web configuration', (value) => {
        expect(containsServerCredential(value)).toBe(true);
        expect(findClientSecretViolations(`const key = ${JSON.stringify(value)};`, 'src/key.ts')).toHaveLength(1);
        try {
            assertPublicSupabaseKey(value);
            expect.unreachable('server credential accepted');
        } catch (error) {
            expect(error.message).toContain('value hidden');
            expect(error.message).not.toContain(value);
        }
    });
    it.each([token('anon'), 'sb_publishable_syntheticOnly', 'test-anon', 'eyJinvalid.notjson.signature', undefined])('allows public/absent configuration without treating it as validated auth', (value) => {
        expect(() => assertPublicSupabaseKey(value)).not.toThrow();
        expect(containsServerCredential(value ?? '')).toBe(false);
    });
    it('retains the server-reference policy and reports location without source text', () => {
        const value = 'never-print-this-secret';
        const violations = findClientSecretViolations(`// ok\nconst SERVICE_ROLE = '${value}';`, 'src/bad.ts');
        expect(violations).toEqual(['src/bad.ts:2: server-only reference or credential (value hidden)']);
        expect(violations.join()).not.toContain(value);
    });
    it('stops the actual Vite configuration hook before transforming a privileged key', () => {
        const plugin = supabaseCspPlugin();
        expect(() => plugin.configResolved({ env: { VITE_SUPABASE_ANON_KEY: admin } })).toThrow('value hidden');
    });
    it('scans client sources and Expo configs, excludes server-only code, and redacts all output', () => {
        const root = mkdtempSync(join(tmpdir(), 'lifequest-credential-test-')); roots.push(root);
        for (const dir of ['src', 'apps/mobile', 'supabase/functions']) mkdirSync(join(root, dir), { recursive: true });
        writeFileSync(join(root, 'src/key.ts'), `export const key = '${admin}';`);
        writeFileSync(join(root, 'apps/mobile/app.config.ts'), "export default { key: 'sb_secret_syntheticConfig' };");
        writeFileSync(join(root, 'supabase/functions/auth.ts'), 'const key = process.env.SERVICE_ROLE;');
        const output = { log: vi.fn(), error: vi.fn() };
        expect(checkClientSecrets(root, output)).toBe(1);
        const logs = JSON.stringify(output.error.mock.calls);
        expect(logs).toContain('src/key.ts:1:');
        expect(logs).toContain('apps/mobile/app.config.ts:1:');
        expect(logs).not.toContain('supabase/functions');
        expect(logs).not.toContain(admin);
        expect(logs).not.toContain('sb_secret_syntheticConfig');
        expect(output.log).not.toHaveBeenCalled();
    });
    it('passes safe sources without requiring optional client directories', () => {
        const root = mkdtempSync(join(tmpdir(), 'lifequest-credential-test-')); roots.push(root);
        mkdirSync(join(root, 'src'));
        writeFileSync(join(root, 'src/key.ts'), `export const key = '${token('anon')}';`);
        expect(checkClientSecrets(root, { log: vi.fn(), error: vi.fn() })).toBe(0);
    });
    it('ignores local env secrets while keeping documented templates trackable', () => {
        const paths = ['.env', '.env.production', 'apps/mobile/.env', 'apps/mobile/.env.preview', '.env.example', '.env.production.example', 'docs/examples/staging-sync.env.example'];
        const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
            input: paths.join('\n') + '\n', encoding: 'utf8',
        }).trim().split('\n');
        expect(ignored).toEqual(paths.slice(0, 4));
    });
});
