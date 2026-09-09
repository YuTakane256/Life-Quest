/**
 * Native Apple sign-in の一回限りの authorization code をサーバーで交換する。
 * client はコードを永続化せず、この関数も refresh token を応答・ログへ出さない。
 */
import { encryptAppleRefreshToken, exchangeAppleAuthorizationCode } from '../_shared/apple.ts';
import { BadRequestError, json, requireString, serveGameFunction } from '../_shared/handler.ts';

function appleSubjectForUser(user: unknown): string | null {
    if (!user || typeof user !== 'object' || !('identities' in user)) return null;
    const identities = (user as { identities?: unknown }).identities;
    if (!Array.isArray(identities)) return null;
    const appleIdentity = identities.find((identity) => identity && typeof identity === 'object' &&
        (identity as { provider?: unknown }).provider === 'apple') as { identity_data?: { sub?: unknown } } | undefined;
    const subject = appleIdentity?.identity_data?.sub;
    return typeof subject === 'string' && subject.length > 0 ? subject : null;
}

serveGameFunction(async (ctx) => {
    const authorizationCode = ctx.body.authorization_code;
    if (typeof authorizationCode !== 'string' || authorizationCode.length === 0 || authorizationCode.length > 8192) {
        throw new BadRequestError('missing_or_invalid_authorization_code');
    }
    const clientId = requireString(ctx.body, 'client_id');
    const { data, error } = await ctx.service.auth.admin.getUserById(ctx.userId);
    const subject = error ? null : appleSubjectForUser(data.user);
    if (!subject) throw new BadRequestError('apple_identity_not_found');

    const exchanged = await exchangeAppleAuthorizationCode(authorizationCode, clientId, subject);
    const encrypted = await encryptAppleRefreshToken(ctx.userId, exchanged.clientId, exchanged.refreshToken);
    const { error: storeError } = await ctx.service.rpc('store_apple_refresh_token', {
        p_user_id: ctx.userId,
        p_client_id: exchanged.clientId,
        p_ciphertext: encrypted.ciphertext,
        p_nonce: encrypted.nonce,
        p_key_version: encrypted.keyVersion,
    });
    if (storeError) return json(500, { error: 'apple_authorization_record_failed' });
    return json(200, { recorded: true });
});
