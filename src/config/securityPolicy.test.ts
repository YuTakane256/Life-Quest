import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';

function getMetaContent(attribute: string, value: string): string {
    const pattern = new RegExp(
        `<meta\\s+[^>]*${attribute}="${value}"[^>]*content="([^"]+)"[^>]*>`,
        'i',
    );
    const match = indexHtml.match(pattern);
    return match?.[1] ?? '';
}

function parsePolicy(policy: string): Map<string, string[]> {
    return new Map(
        policy
            .split(';')
            .map((directive) => directive.trim())
            .filter(Boolean)
            .map((directive) => {
                const [name, ...sources] = directive.split(/\s+/);
                return [name, sources] as const;
            }),
    );
}

describe('app shell security policy', () => {
    it('keeps a restrictive Content Security Policy for the PWA shell', () => {
        const policy = parsePolicy(getMetaContent('http-equiv', 'Content-Security-Policy'));

        expect(policy.get('default-src')).toEqual(["'self'"]);
        expect(policy.get('script-src')).toEqual(["'self'"]);
        expect(policy.get('object-src')).toEqual(["'none'"]);
        expect(policy.get('frame-src')).toEqual(["'none'"]);
        expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
        expect(policy.get('form-action')).toEqual(["'none'"]);
        expect(policy.get('base-uri')).toEqual(["'self'"]);
        expect(policy.get('connect-src')).toEqual(["'self'"]);
        expect(policy.get('manifest-src')).toEqual(["'self'"]);
        expect(policy.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
        expect(policy.get('media-src')).toEqual(["'self'", 'data:', 'blob:']);
        expect(policy.get('worker-src')).toEqual(["'self'", 'blob:']);
        expect(policy.has('upgrade-insecure-requests')).toBe(true);
        expect(policy.get('script-src')).not.toContain("'unsafe-inline'");
        expect(policy.get('script-src')).not.toContain("'unsafe-eval'");
    });

    it('keeps referrer and permissions policies locked down', () => {
        expect(getMetaContent('name', 'referrer')).toBe('strict-origin-when-cross-origin');
        expect(getMetaContent('http-equiv', 'Permissions-Policy')).toBe(
            'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=(self)',
        );
    });
});
