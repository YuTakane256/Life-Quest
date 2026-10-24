import type { Plugin } from 'vite';

/** Permit only the configured Supabase origin and its Realtime WebSocket origin. */
export function supabaseConnectSources(value: string | undefined): string[] {
    if (!value) return ["'self'"];
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error('VITE_SUPABASE_URL is invalid (value hidden).'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (value.trim() !== value || url.username || url.password || url.pathname !== '/' || url.search || url.hash
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
            sources = supabaseConnectSources(config.env.VITE_SUPABASE_URL);
        },
        transformIndexHtml(html) { return applySupabaseConnectPolicy(html, sources); },
    };
}
