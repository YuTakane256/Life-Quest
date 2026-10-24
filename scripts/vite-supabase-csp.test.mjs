// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applySupabaseConnectPolicy, supabaseConnectSources } from './vite-supabase-csp.ts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
describe('Supabase接続先だけを許可するCSP', () => {
    it('環境未設定のローカル版は元の制限を維持する', () => {
        expect(applySupabaseConnectPolicy(html, supabaseConnectSources(undefined))).toBe(html);
    });
    it('設定先のHTTPS/WSSだけを追加し、script/object/frame等の制限を変えない', () => {
        const sources = supabaseConnectSources('https://abcdefghijklmnopqrst.supabase.co');
        expect(sources).toEqual(["'self'", 'https://abcdefghijklmnopqrst.supabase.co', 'wss://abcdefghijklmnopqrst.supabase.co']);
        const result = applySupabaseConnectPolicy(html, sources);
        expect(result.replace(`connect-src ${sources.join(' ')};`, "connect-src 'self';")).toBe(html);
        expect(result).not.toContain('*.supabase.co');
    });
    it.each(['http://127.0.0.1:55321', 'http://localhost:55321', 'http://[::1]:55321'])('ローカルDB %sは同一ホスト/ポートのHTTP/WSだけを許可する', (url) => {
        expect(supabaseConnectSources(url)).toEqual(["'self'", url, url.replace('http:', 'ws:')]);
    });
    it.each(['not-a-url', 'http://remote.example.test', 'javascript:alert(1)',
        'https://user:private-sentinel@example.test', 'https://example.test/path',
        'https://example.test/?private-sentinel', 'https://example.test/#private-sentinel',
        'https://example.test;script-src *', ' https://example.test', 'https://example.test\n'])('危険・不正な接続設定を値非表示で拒否する', (value) => {
        expect(() => supabaseConnectSources(value)).toThrow();
        try { supabaseConnectSources(value); } catch (error) { expect(error.message).not.toContain('private-sentinel'); }
    });
    it('CSPの構造が変わった時に無言で許可を追加しない', () => {
        expect(() => applySupabaseConnectPolicy('<html></html>', ["'self'"])).toThrow();
        expect(() => applySupabaseConnectPolicy(html + html, ["'self'"])).toThrow();
    });
});
