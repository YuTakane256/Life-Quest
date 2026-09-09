/** Store the temporary provider refresh token returned by Supabase's web Apple OAuth callback. */
import { encryptAppleRefreshToken, verifyAppleWebRefreshToken } from '../_shared/apple.ts';
import { BadRequestError, json, serveGameFunction } from '../_shared/handler.ts';

function appleSubjectForUser(user: unknown): string | null {
    if (!user || typeof user !== 'object' || !('identities' in user)) return null;
    const identities = (user as { identities?: unknown }).identities;
    if (!Array.isArray(identities)) return null;
    const identity = identities.find((value) => value && typeof value === 'object' &&
        (value as { provider?: unknown }).provider === 'apple') as { identity_data?: { sub?: unknown } } | undefined;
    return typeof identity?.identity_data?.sub === 'string' ? identity.identity_data.sub : null;
}

serveGameFunction(async (ctx) => {
    const refreshToken = ctx.body.refresh_token;
    if (typeof refreshToken !== 'string' || refreshToken.length === 0 || refreshToken.length > 8192) {
        throw new BadRequestError('missing_or_invalid_refresh_token');
    }
    const { data, error: userError } = await ctx.service.auth.admin.getUserById(ctx.userId);
    const subject = userError ? null : appleSubjectForUser(data.user);
    if (!subject) throw new BadRequestError('apple_identity_not_found');
    const exchanged = await verifyAppleWebRefreshToken(refreshToken, subject);
    const encrypted = await encryptAppleRefreshToken(ctx.userId, exchanged.clientId, exchanged.refreshToken);
    const { error } = await ctx.service.rpc('store_apple_refresh_token', {
        p_user_id: ctx.userId,
        p_client_id: exchanged.clientId,
        p_ciphertext: encrypted.ciphertext,
        p_nonce: encrypted.nonce,
        p_key_version: encrypted.keyVersion,
    });
    if (error) return json(500, { error: 'apple_authorization_record_failed' });
    return json(200, { recorded: true });
});
