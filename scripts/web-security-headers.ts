import type { Plugin } from 'vite';
import { WEB_RESPONSE_SECURITY_HEADERS } from '../src/config/webSecurityPolicy.ts';
export { WEB_RESPONSE_SECURITY_HEADERS } from '../src/config/webSecurityPolicy.ts';

// Keep the existing HTML CSP for scripts/connect-src. A separate header policy
// supplies frame-ancestors, which browsers ignore in a meta CSP.
export function staticSecurityHeaders(): string {
    return `/*\n${Object.entries(WEB_RESPONSE_SECURITY_HEADERS)
        .map(([name, value]) => `  ${name}: ${value}`).join('\n')}\n`;
}

export function webSecurityHeadersPlugin(): Plugin {
    return {
        name: 'life-quest-web-response-security',
        config: () => ({
            server: { headers: { ...WEB_RESPONSE_SECURITY_HEADERS } },
            preview: { headers: { ...WEB_RESPONSE_SECURITY_HEADERS } },
        }),
        generateBundle() {
            // Static hosts that support _headers can apply the same policy.
            // Other hosts still require explicit response-header configuration.
            this.emitFile({ type: 'asset', fileName: '_headers', source: staticSecurityHeaders() });
        },
    };
}
