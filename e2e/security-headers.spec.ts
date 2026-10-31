import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

test('security headers cover app navigation and deep links', async ({ page, request }) => {
    for (const path of ['/tasks', '/settings']) {
        const response = await request.get(path);
        expect(response.ok()).toBe(true);
        expect(response.headers()['content-security-policy']).toBe("frame-ancestors 'none'");
        expect(response.headers()['x-frame-options']).toBe('DENY');
        expect(response.headers()['x-content-type-options']).toBe('nosniff');
        expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
        expect(response.headers()['permissions-policy']).toContain('camera=()');
        expect(response.headers()['permissions-policy']).toContain('clipboard-write=(self)');
    }
    await page.goto('/tasks');
    await expect(page.locator('#root')).not.toBeEmpty();
    const features = await page.evaluate(() => {
        const policy = (document as Document & {
            featurePolicy?: { allowsFeature: (name: string) => boolean };
        }).featurePolicy;
        return {
            camera: policy?.allowsFeature('camera'),
            microphone: policy?.allowsFeature('microphone'),
            geolocation: policy?.allowsFeature('geolocation'),
            clipboardWrite: policy?.allowsFeature('clipboard-write'),
        };
    });
    expect(features).toEqual({ camera: false, microphone: false, geolocation: false, clipboardWrite: true });
});

test('the browser refuses embedding from an untrusted parent', async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    const target = new URL('/settings', baseURL).href;
    // Use a real second loopback origin. A synthetic public origin could be
    // stopped by Private Network Access before the app's CSP is evaluated.
    const parent = createServer((_req, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        response.end(`<!doctype html><html><body><iframe id="target" src="${target}"></iframe></body></html>`);
    });
    await new Promise<void>((resolve) => parent.listen(0, '127.0.0.1', resolve));
    try {
        // Negative control proves this harness allows an unprotected page.
        await page.route(target, (route) => route.fulfill({
            contentType: 'text/html', headers: { 'Cache-Control': 'no-store' },
            body: '<!doctype html><div id="root">Embedding control</div>',
        }));
        await page.goto(`http://127.0.0.1:${(parent.address() as AddressInfo).port}/`);
        await expect(page.frameLocator('#target').locator('#root')).toHaveText('Embedding control');
        await page.unroute(target);
        errors.length = 0;
        await page.reload();
        await expect.poll(() => errors.some((message) =>
            /frame-ancestors|X-Frame-Options/i.test(message) && /blocked|refused|violat/i.test(message)),
        ).toBe(true);
        await expect(page.frameLocator('#target').locator('#root')).toHaveCount(0);
    } finally {
        await new Promise<void>((resolve, reject) => parent.close((error) => error ? reject(error) : resolve()));
    }
});
