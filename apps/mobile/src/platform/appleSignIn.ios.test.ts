import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    signInAsync: vi.fn(),
    getRandomBytesAsync: vi.fn(),
    digestStringAsync: vi.fn(),
    signInWithIdToken: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
}));

vi.mock('expo-apple-authentication', () => ({
    signInAsync: state.signInAsync,
    AppleAuthenticationScope: { FULL_NAME: 'FULL_NAME', EMAIL: 'EMAIL' },
    AppleAuthenticationError: { CANCELED: 'ERR_REQUEST_CANCELED' },
}));

vi.mock('expo-crypto', () => ({
    getRandomBytesAsync: state.getRandomBytesAsync,
    digestStringAsync: state.digestStringAsync,
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

import { signInWithAppleNative } from './appleSignIn.ios';

const client = { auth: { signInWithIdToken: state.signInWithIdToken, updateUser: state.updateUser } };

describe('iOS Apple Sign In', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('nonceとstateを検証してからSupabaseへID tokenを渡し、同期は直接開始しない', async () => {
        state.getRandomBytesAsync.mockResolvedValue(new Uint8Array(32).fill(1));
        state.digestStringAsync.mockResolvedValue('hashed-nonce');
        state.signInAsync.mockImplementation(async ({ state: expectedState }) => ({
            state: expectedState,
            identityToken: 'identity-token',
            authorizationCode: 'authorization-code',
            fullName: { givenName: 'Ada', familyName: 'Lovelace' },
        }));

        await expect(signInWithAppleNative(client)).resolves.toEqual({ ok: true });
        expect(state.digestStringAsync).toHaveBeenCalledWith('SHA256', expect.any(String));
        expect(state.signInWithIdToken).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'apple', token: 'identity-token', nonce: expect.any(String), access_token: 'authorization-code',
        }));
        expect(state.updateUser).toHaveBeenCalledWith({ data: { full_name: 'Ada Lovelace' } });
    });

    it('state不一致またはidentity token欠落ではSupabaseを呼ばない', async () => {
        state.getRandomBytesAsync.mockResolvedValue(new Uint8Array(32).fill(2));
        state.digestStringAsync.mockResolvedValue('hashed-nonce');
        state.signInAsync.mockResolvedValue({ state: 'unexpected', identityToken: 'identity-token', fullName: null });
        await expect(signInWithAppleNative(client)).resolves.toMatchObject({ ok: false });
        state.signInAsync.mockResolvedValue({ state: 'unexpected', identityToken: null, fullName: null });
        await expect(signInWithAppleNative(client)).resolves.toMatchObject({ ok: false });
        expect(state.signInWithIdToken).not.toHaveBeenCalled();
    });

    it('キャンセルは中立的な結果にし、エラー後に再試行できる', async () => {
        state.getRandomBytesAsync.mockResolvedValue(new Uint8Array(32).fill(3));
        state.digestStringAsync.mockResolvedValue('hashed-nonce');
        state.signInAsync.mockRejectedValueOnce({ code: 'ERR_REQUEST_CANCELED' });
        await expect(signInWithAppleNative(client)).resolves.toEqual({ ok: false, message: 'Appleログインをキャンセルしました。' });
        state.signInAsync.mockImplementationOnce(async ({ state: expectedState }) => ({ state: expectedState, identityToken: 'next-token', fullName: null }));
        await expect(signInWithAppleNative(client)).resolves.toEqual({ ok: true });
        expect(state.signInWithIdToken).toHaveBeenCalledTimes(1);
    });
});
