/**
 * Apple の認可コード交換とトークン失効処理。
 *
 * Apple の private key と refresh token はこのサーバー専用モジュールから外へ返さない。
 * 呼び出し元は失敗理由を利用者へ公開せず、退会を安全に中止する。
 */
const APPLE_BASE_URL = 'https://appleid.apple.com';
const textEncoder = new TextEncoder();

export class AppleAuthorizationError extends Error {
    constructor(readonly code: 'configuration' | 'exchange_failed' | 'subject_mismatch' | 'revoke_failed' | 'revoke_unusable') {
        super(code);
    }
}

interface AppleConfig {
    teamId: string;
    keyId: string;
    privateKey: string;
}

interface AppleTokenResponse {
    refresh_token?: unknown;
    id_token?: unknown;
    error?: unknown;
}

export interface EncryptedAppleToken {
    ciphertext: string;
    nonce: string;
    keyVersion: string;
}

interface AppleJwtHeader { alg?: unknown; kid?: unknown; }
interface AppleJwtPayload { iss?: unknown; aud?: unknown; exp?: unknown; sub?: unknown; }

function requiredAppleConfig(): AppleConfig {
    const teamId = Deno.env.get('APPLE_TEAM_ID');
    const keyId = Deno.env.get('APPLE_KEY_ID');
    const privateKey = Deno.env.get('APPLE_PRIVATE_KEY');
    if (!teamId || !keyId || !privateKey) throw new AppleAuthorizationError('configuration');
    return { teamId, keyId, privateKey: privateKey.replace(/\\n/g, '\n') };
}

function allowedAppleClientIds(): string[] {
    const configured = Deno.env.get('APPLE_CLIENT_IDS') ?? Deno.env.get('APPLE_CLIENT_ID') ?? '';
    const clientIds = configured.split(',').map((value) => value.trim()).filter(Boolean);
    if (clientIds.length === 0 || new Set(clientIds).size !== clientIds.length) throw new AppleAuthorizationError('configuration');
    return clientIds;
}

function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(value: string): Uint8Array | null {
    try {
        const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
        const binary = atob(padded);
        return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } catch {
        return null;
    }
}

function tokenEncryptionConfig(): { key: Uint8Array; keyVersion: string } {
    const encodedKey = Deno.env.get('APPLE_TOKEN_ENCRYPTION_KEY');
    const keyVersion = Deno.env.get('APPLE_TOKEN_KEY_VERSION') ?? 'v1';
    const key = encodedKey ? base64UrlDecode(encodedKey) : null;
    if (!key || key.length !== 32 || !/^[A-Za-z0-9._-]{1,64}$/.test(keyVersion)) throw new AppleAuthorizationError('configuration');
    return { key, keyVersion };
}

async function tokenCipher(): Promise<{ key: CryptoKey; keyVersion: string }> {
    const config = tokenEncryptionConfig();
    try {
        return {
            key: await crypto.subtle.importKey('raw', config.key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
            keyVersion: config.keyVersion,
        };
    } catch {
        throw new AppleAuthorizationError('configuration');
    }
}

/** Encrypt before private DB storage; plaintext never leaves this Edge Function. */
function tokenAad(userId: string, clientId: string, keyVersion: string): Uint8Array {
    return textEncoder.encode(`${userId}:${clientId}:${keyVersion}`);
}

export async function encryptAppleRefreshToken(userId: string, clientId: string, refreshToken: string): Promise<EncryptedAppleToken> {
    const { key, keyVersion } = await tokenCipher();
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: tokenAad(userId, clientId, keyVersion) }, key, textEncoder.encode(refreshToken));
    return { ciphertext: base64UrlEncode(new Uint8Array(ciphertext)), nonce: base64UrlEncode(nonce), keyVersion };
}

/** A key-version mismatch is intentionally fatal rather than attempting a guess. */
export async function decryptAppleRefreshToken(userId: string, record: { client_id: unknown; ciphertext: unknown; nonce: unknown; key_version: unknown }): Promise<string> {
    const { key, keyVersion } = await tokenCipher();
    if (record.key_version !== keyVersion || typeof record.client_id !== 'string' || typeof record.ciphertext !== 'string' || typeof record.nonce !== 'string') {
        throw new AppleAuthorizationError('revoke_failed');
    }
    const ciphertext = base64UrlDecode(record.ciphertext);
    const nonce = base64UrlDecode(record.nonce);
    if (!ciphertext || !nonce || nonce.length !== 12) throw new AppleAuthorizationError('revoke_failed');
    try {
        return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: tokenAad(userId, record.client_id, keyVersion) }, key, ciphertext));
    } catch {
        throw new AppleAuthorizationError('revoke_failed');
    }
}

function pkcs8FromPem(pem: string): Uint8Array | null {
    const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
    return body ? base64UrlDecode(body.replace(/\+/g, '-').replace(/\//g, '_')) : null;
}

async function appleClientSecret(config: AppleConfig, clientId: string): Promise<string> {
    const keyData = pkcs8FromPem(config.privateKey);
    if (!keyData) throw new AppleAuthorizationError('configuration');
    let privateKey: CryptoKey;
    try {
        privateKey = await crypto.subtle.importKey(
            'pkcs8', keyData, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
        );
    } catch {
        throw new AppleAuthorizationError('configuration');
    }
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(textEncoder.encode(JSON.stringify({ alg: 'ES256', kid: config.keyId })));
    const payload = base64UrlEncode(textEncoder.encode(JSON.stringify({
        iss: config.teamId,
        iat: now,
        exp: now + 300,
        aud: APPLE_BASE_URL,
        sub: clientId,
    })));
    const unsigned = `${header}.${payload}`;
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, textEncoder.encode(unsigned));
    return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function parseAppleJwt(idToken: string): { header: AppleJwtHeader; payload: AppleJwtPayload; signature: Uint8Array; signed: string } | null {
    const [encodedHeader, encodedPayload, encodedSignature, ...extra] = idToken.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra.length !== 0) return null;
    const header = base64UrlDecode(encodedHeader);
    const payload = base64UrlDecode(encodedPayload);
    const signature = base64UrlDecode(encodedSignature);
    if (!header || !payload || !signature) return null;
    try {
        return {
            header: JSON.parse(new TextDecoder().decode(header)) as AppleJwtHeader,
            payload: JSON.parse(new TextDecoder().decode(payload)) as AppleJwtPayload,
            signature,
            signed: `${encodedHeader}.${encodedPayload}`,
        };
    } catch { return null; }
}

async function verifyAppleIdToken(idToken: string, expectedSubject: string, clientId: string): Promise<void> {
    const parsed = parseAppleJwt(idToken);
    if (!parsed || parsed.header.alg !== 'RS256' || typeof parsed.header.kid !== 'string') throw new AppleAuthorizationError('subject_mismatch');
    const now = Math.floor(Date.now() / 1000);
    const audienceMatches = parsed.payload.aud === clientId || (Array.isArray(parsed.payload.aud) && parsed.payload.aud.includes(clientId));
    if (parsed.payload.iss !== APPLE_BASE_URL || !audienceMatches || typeof parsed.payload.exp !== 'number' || parsed.payload.exp <= now || parsed.payload.sub !== expectedSubject) {
        throw new AppleAuthorizationError('subject_mismatch');
    }
    let keys: { keys?: JsonWebKey[] };
    try {
        const response = await fetch(`${APPLE_BASE_URL}/auth/keys`);
        if (!response.ok) throw new Error('apple_jwks_failed');
        keys = await response.json() as { keys?: JsonWebKey[] };
    } catch { throw new AppleAuthorizationError('exchange_failed'); }
    const jwk = keys.keys?.find((key) => key.kid === parsed.header.kid && key.kty === 'RSA');
    if (!jwk) throw new AppleAuthorizationError('subject_mismatch');
    try {
        const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        if (!await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, publicKey, parsed.signature, textEncoder.encode(parsed.signed))) {
            throw new AppleAuthorizationError('subject_mismatch');
        }
    } catch (error) {
        if (error instanceof AppleAuthorizationError) throw error;
        throw new AppleAuthorizationError('subject_mismatch');
    }
}

async function applePost(path: string, body: URLSearchParams): Promise<{ status: number; data: AppleTokenResponse | null }> {
    let response: Response;
    try {
        response = await fetch(`${APPLE_BASE_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
    } catch {
        throw new AppleAuthorizationError(path === '/auth/token' ? 'exchange_failed' : 'revoke_failed');
    }
    let data: AppleTokenResponse | null = null;
    try { data = await response.json() as AppleTokenResponse; } catch { /* failure remains generic */ }
    return { status: response.status, data };
}

/** Exchange a short-lived code and bind it to the authenticated Apple subject. */
export async function exchangeAppleAuthorizationCode(authorizationCode: string, clientId: string, expectedSubject: string): Promise<{ clientId: string; refreshToken: string }> {
    const config = requiredAppleConfig();
    if (!allowedAppleClientIds().includes(clientId)) throw new AppleAuthorizationError('configuration');
    const clientSecret = await appleClientSecret(config, clientId);
    const { status, data } = await applePost('/auth/token', new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, code: authorizationCode, grant_type: 'authorization_code',
    }));
    if (status !== 200 || !data || typeof data.refresh_token !== 'string' || typeof data.id_token !== 'string') throw new AppleAuthorizationError('exchange_failed');
    await verifyAppleIdToken(data.id_token, expectedSubject, clientId);
    return { clientId, refreshToken: data.refresh_token };
}

/**
 * Any non-200 result is fail-closed. Apple normally returns 200 for an already
 * revoked refresh token; accepting an error could delete a still-authorized user.
 */
export async function revokeAppleRefreshToken(clientId: string, refreshToken: string): Promise<void> {
    const config = requiredAppleConfig();
    if (!allowedAppleClientIds().includes(clientId)) throw new AppleAuthorizationError('configuration');
    const clientSecret = await appleClientSecret(config, clientId);
    const { status, data } = await applePost('/auth/revoke', new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: refreshToken,
        token_type_hint: 'refresh_token',
    }));
    if (status === 200) return;
    // This token is already unusable, but Apple did not confirm a successful
    // revoke. Preserve that distinction for the account-deletion warning.
    if (status === 400 && data?.error === 'invalid_grant') throw new AppleAuthorizationError('revoke_unusable');
    throw new AppleAuthorizationError('revoke_failed');
}

/** Web OAuth is configured with one server-owned Services ID. */
export function appleWebClientId(): string {
    const clientId = Deno.env.get('APPLE_WEB_CLIENT_ID');
    if (!clientId || !allowedAppleClientIds().includes(clientId)) throw new AppleAuthorizationError('configuration');
    return clientId;
}

/** Validate a web provider refresh token with Apple before it is retained. */
export async function verifyAppleWebRefreshToken(refreshToken: string, expectedSubject: string): Promise<{ clientId: string; refreshToken: string }> {
    const clientId = appleWebClientId();
    const config = requiredAppleConfig();
    const clientSecret = await appleClientSecret(config, clientId);
    const { status, data } = await applePost('/auth/token', new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
    }));
    if (status !== 200 || !data || typeof data.id_token !== 'string') throw new AppleAuthorizationError('exchange_failed');
    await verifyAppleIdToken(data.id_token, expectedSubject, clientId);
    return { clientId, refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken };
}
