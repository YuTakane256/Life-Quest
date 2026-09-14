// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';

const env = new Map<string, string>();
const denoGlobal = globalThis as typeof globalThis & { Deno: { env: { get: (name: string) => string | undefined } } };
denoGlobal.Deno = { env: { get: (name) => env.get(name) } };
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsaJwk = rsa.publicKey.export({ format: 'jwk' });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function idToken(payload: Record<string, unknown>, tamper = false): string {
    const signed = `${encode({ alg: 'RS256', kid: 'apple-test-key' })}.${encode(payload)}`;
    const signer = createSign('RSA-SHA256'); signer.update(signed); signer.end();
    const signature = signer.sign(rsa.privateKey).toString('base64url');
    const tamperedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    return `${signed}.${tamper ? tamperedSignature : signature}`;
}

function configure(): void {
    env.clear();
    env.set('APPLE_CLIENT_ID', 'com.example.lifequest');
    env.set('APPLE_TEAM_ID', 'team-id');
    env.set('APPLE_KEY_ID', 'key-id');
    env.set('APPLE_PRIVATE_KEY', privateKeyPem);
    env.set('APPLE_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64url'));
}

afterEach(() => { vi.unstubAllGlobals(); configure(); });

describe('Apple server-only token protection', () => {
    it('AES-GCM token ciphertext requires the original user/client AAD', async () => {
        configure();
        const { decryptAppleRefreshToken, encryptAppleRefreshToken } = await import('../functions/_shared/apple.ts');
        const encrypted = await encryptAppleRefreshToken('user-a', 'com.example.lifequest', 'refresh-token');
        await expect(decryptAppleRefreshToken('user-a', {
            client_id: 'com.example.lifequest', ciphertext: encrypted.ciphertext, nonce: encrypted.nonce, key_version: encrypted.keyVersion,
        })).resolves.toBe('refresh-token');
        await expect(decryptAppleRefreshToken('user-b', {
            client_id: 'com.example.lifequest', ciphertext: encrypted.ciphertext, nonce: encrypted.nonce, key_version: encrypted.keyVersion,
        })).rejects.toMatchObject({ code: 'revoke_failed' });
    });

    it('revoke accepts only HTTP 200 and classifies invalid_grant for manual follow-up', async () => {
        configure();
        const { AppleAuthorizationError, revokeAppleRefreshToken } = await import('../functions/_shared/apple.ts');
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
        await expect(revokeAppleRefreshToken('com.example.lifequest', 'refresh-token')).resolves.toBeUndefined();
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
        await expect(revokeAppleRefreshToken('com.example.lifequest', 'refresh-token')).rejects.toBeInstanceOf(AppleAuthorizationError);
        await expect(revokeAppleRefreshToken('com.example.lifequest', 'refresh-token')).rejects.toMatchObject({ code: 'revoke_unusable' });
    });

    it.each([
        ['accepts a valid RS256 Apple identity token', {}, false, true],
        ['rejects a different audience', { aud: 'other-client' }, false, false],
        ['rejects a different subject', { sub: 'other-user' }, false, false],
        ['rejects an expired token', { exp: Math.floor(Date.now() / 1000) - 1 }, false, false],
        ['rejects a tampered signature', {}, true, false],
    ])('%s', async (_label, overrides, tamper, shouldPass) => {
        configure();
        const { exchangeAppleAuthorizationCode } = await import('../functions/_shared/apple.ts');
        const payload = {
            iss: 'https://appleid.apple.com', aud: 'com.example.lifequest', sub: 'apple-user',
            exp: Math.floor(Date.now() / 1000) + 300, ...overrides as Record<string, unknown>,
        };
        const token = idToken(payload, tamper);
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/auth/keys')
            ? new Response(JSON.stringify({ keys: [{ ...rsaJwk, kid: 'apple-test-key', kty: 'RSA' }] }), { status: 200 })
            : new Response(JSON.stringify({ refresh_token: 'refresh-token', id_token: token }), { status: 200 })));
        const operation = exchangeAppleAuthorizationCode('code', 'com.example.lifequest', 'apple-user');
        if (shouldPass) await expect(operation).resolves.toMatchObject({ clientId: 'com.example.lifequest' });
        else await expect(operation).rejects.toMatchObject({ code: expect.any(String) });
    });
});
