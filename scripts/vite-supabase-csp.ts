import type { Plugin } from 'vite';
import { isIP } from 'node:net';
import { containsServerCredential } from './check-service-role.mjs';

export function assertPublicSupabaseKey(value: string | undefined): void {
    if (value && containsServerCredential(value)) {
        throw new Error('VITE_SUPABASE_ANON_KEY contains a server-only credential (value hidden).');
    }
}

/** Permit only the configured Supabase origin and its Realtime WebSocket origin. */
export function supabaseConnectSources(value: string | undefined): string[] {
    if (!value) return ["'self'"];
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error('VITE_SUPABASE_URL is invalid (value hidden).'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    // URL accepts host characters such as '*' and ';' that have special CSP meaning.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const dnsHost = host.length <= 253 && host.replace(/\.$/, '').split('.')
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
    if (value.trim() !== value || url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || !(isIP(host) || dnsHost)
        || !(url.protocol === 'https:' || (local && url.protocol === 'http:'))) {
        throw new Error('VITE_SUPABASE_URL must be an HTTPS origin or local HTTP origin (value hidden).');
    }
    const websocket = new URL(url.origin);
    websocket.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return ["'self'", url.origin, websocket.origin];
}

export function applySupabaseConnectPolicy(html: string, sources: string[]): string {
    const baseline = "connect-src 'self';";
    if (html.split(baseline).length !== 2) throw new Error('Expected one baseline connect-src policy in app HTML.');
    return html.replace(baseline, `connect-src ${sources.join(' ')};`);
}

export function supabaseCspPlugin(): Plugin {
    let sources = ["'self'"];
    return {
        name: 'life-quest-supabase-csp',
        configResolved(config) {
            // Resolved env respects envDir=false in the isolated staging config.
            assertPublicSupabaseKey(config.env.VITE_SUPABASE_ANON_KEY);
            sources = supabaseConnectSources(config.env.VITE_SUPABASE_URL);
        },
        transformIndexHtml(html) { return applySupabaseConnectPolicy(html, sources); },
    };
}
