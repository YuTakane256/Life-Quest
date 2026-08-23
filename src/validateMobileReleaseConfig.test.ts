import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function runReleaseValidation(environment: Record<string, string>): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, ['scripts/validate-mobile-release-config.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, ...environment },
        encoding: 'utf8',
    });
}

describe('mobile release configuration validation', () => {
    it('rejects a public Supabase secret key injected through the environment', () => {
        const result = runReleaseValidation({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_not-for-mobile' });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('sb_secret_*');
    });

    it('rejects a public JWT with a privileged database role', () => {
        const privilegedRole = ['service', 'role'].join('_');
        const payload = Buffer.from(JSON.stringify({ role: privilegedRole })).toString('base64url');
        const serviceRoleJwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
        const result = runReleaseValidation({ EXPO_PUBLIC_SUPABASE_ANON_KEY: serviceRoleJwt });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`role=${privilegedRole}`);
    });
});
