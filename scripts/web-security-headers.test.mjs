// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, createServer, preview, resolveConfig } from 'vite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_RESPONSE_SECURITY_HEADERS, staticSecurityHeaders, webSecurityHeadersPlugin } from './web-security-headers.ts';

const fixture = mkdtempSync(join(tmpdir(), 'lifequest-web-headers-'));
const servers = {};
beforeAll(async () => {
    writeFileSync(join(fixture, 'index.html'), '<!doctype html><html><body>Header fixture</body></html>');
    const options = { configFile: false, root: fixture, logLevel: 'silent', plugins: [webSecurityHeadersPlugin()] };
    await build({ ...options, build: { outDir: join(fixture, 'dist') } });
    servers.dev = await createServer({ ...options, server: { host: '127.0.0.1', port: 0, strictPort: true } });
    await servers.dev.listen();
    servers.preview = await preview({ ...options, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
}, 30_000);
afterAll(async () => {
    await servers.dev?.close();
    if (servers.preview) await new Promise((resolve, reject) => servers.preview.httpServer.close((error) => error ? reject(error) : resolve()));
    rmSync(fixture, { recursive: true, force: true });
});

describe.each(['dev', 'preview'])('%s actual response headers', (mode) => {
    it.each(['/', '/settings'])('%s receives the restrictive headers, including SPA fallback', async (path) => {
        const port = servers[mode].httpServer.address().port;
        const response = await fetch(`http://127.0.0.1:${port}${path}`);
        expect(response.status).toBe(200);
        for (const [name, value] of Object.entries(WEB_RESPONSE_SECURITY_HEADERS)) {
            expect(response.headers.get(name)).toBe(value);
        }
        expect(await response.text()).toContain('Header fixture');
    });
});
it('emits the same policy for static hosts without an environment value', () => {
    const output = readFileSync(join(fixture, 'dist/_headers'), 'utf8');
    expect(output).toBe(staticSecurityHeaders());
    expect(output.split('\n')[0]).toBe('/*');
    for (const [name, value] of Object.entries(WEB_RESPONSE_SECURITY_HEADERS)) expect(output).toContain(`  ${name}: ${value}\n`);
    expect(output).not.toMatch(/supabase|token|secret/i);
});
it.each(['vite.config.ts', 'vite.staging.config.ts'])('%s wires both development and preview protection', async (name) => {
    const config = await resolveConfig({ configFile: fileURLToPath(new URL(`../${name}`, import.meta.url)), envDir: false, logLevel: 'silent' }, 'serve');
    expect(config.server.headers).toMatchObject(WEB_RESPONSE_SECURITY_HEADERS);
    expect(config.preview.headers).toMatchObject(WEB_RESPONSE_SECURITY_HEADERS);
});
