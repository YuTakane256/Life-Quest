import type { AppleSignInResult } from './appleSignIn.ios';

type AppleAuthClient = Parameters<typeof import('./appleSignIn.ios').signInWithAppleNative>[0];

/** Keeps Android from invoking the iOS-only Apple authentication module. */
export async function signInWithAppleNative(client: AppleAuthClient): Promise<AppleSignInResult> {
    if (process.env.EXPO_OS !== 'ios') return { ok: false, message: 'AppleログインはiOSで利用できます。' };
    const { signInWithAppleNative: signInOnIos } = await import('./appleSignIn.ios');
    return signInOnIos(client);
}
