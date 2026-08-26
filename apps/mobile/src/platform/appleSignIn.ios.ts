import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

export type AppleSignInResult =
    | { ok: true }
    | { ok: false; message: string };

type AppleAuthClient = {
    auth: {
        signInWithIdToken: (credentials: {
            provider: 'apple';
            token: string;
            nonce: string;
            access_token?: string;
        }) => Promise<{ error: Error | null }>;
        updateUser: (attributes: { data: Record<string, string> }) => Promise<{ error: Error | null }>;
    };
};

function authFailure(): AppleSignInResult {
    return { ok: false, message: 'Appleでログインを完了できませんでした。もう一度お試しください。' };
}

function isCancellation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error &&
        (error as { code?: string }).code === 'ERR_REQUEST_CANCELED';
}

async function createSecureValue(): Promise<string> {
    const bytes = await Crypto.getRandomBytesAsync(32);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Native iOS Apple Sign In. Supabase validates the identity token and owns session events. */
export async function signInWithAppleNative(client: AppleAuthClient): Promise<AppleSignInResult> {
    try {
        const [rawNonce, state] = await Promise.all([createSecureValue(), createSecureValue()]);
        const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
        const credential = await AppleAuthentication.signInAsync({
            requestedScopes: [
                AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
            nonce: hashedNonce,
            state,
        });
        const returnedState = (credential as { state?: string | null }).state;
        if (returnedState !== state || !credential.identityToken) return authFailure();
        const { error } = await client.auth.signInWithIdToken({
            provider: 'apple',
            token: credential.identityToken,
            nonce: rawNonce,
            ...(credential.authorizationCode ? { access_token: credential.authorizationCode } : {}),
        });
        if (error) return authFailure();

        // Apple sends names only on first consent. Never use them for Life Quest's character name.
        const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ').trim();
        if (fullName) await client.auth.updateUser({ data: { full_name: fullName } });
        return { ok: true };
    } catch (error) {
        if (isCancellation(error)) return { ok: false, message: 'Appleログインをキャンセルしました。' };
        return authFailure();
    }
}
