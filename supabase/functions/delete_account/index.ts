/**
 * delete_account (#516)。対象ユーザーは必ずJWTから決定する。
 * bodyのuserId等は一切読まず、成功時だけauth.usersを物理削除してFK cascadeを発火する。
 * Apple identity がある場合は、必ずサーバー側でApple認可を失効してから削除する。
 */
import { AppleAuthorizationError, decryptAppleRefreshToken, revokeAppleRefreshToken } from '../_shared/apple.ts';
import { json, serveGameFunction } from '../_shared/handler.ts';

serveGameFunction(async (ctx) => {
    const { data: userData, error: userError } = await ctx.service.auth.admin.getUserById(ctx.userId);
    if (userError || !userData.user) return json(500, { error: 'account_deletion_failed' });
    const hasAppleIdentity = Array.isArray(userData.user.identities) && userData.user.identities.some((identity) => identity.provider === 'apple');
    if (hasAppleIdentity) {
        const { data: tokenRecords, error: tokenError } = await ctx.service.rpc('get_apple_refresh_tokens', { p_user_id: ctx.userId });
        if (tokenError || !Array.isArray(tokenRecords)) return json(500, { error: 'account_deletion_failed' });
        let manualRevocationRequired = tokenRecords.length === 0 || tokenRecords.some((record) =>
            record && typeof record === 'object' && (record as { manual_required_at?: unknown }).manual_required_at != null);
        try {
            for (const record of tokenRecords) {
                if (!record || typeof record !== 'object') throw new Error('invalid_apple_token_record');
                const typed = record as { client_id?: unknown; revoked_at?: unknown; manual_required_at?: unknown; ciphertext?: unknown; nonce?: unknown; key_version?: unknown };
                if (typed.revoked_at != null || typed.manual_required_at != null) continue;
                if (typeof typed.client_id !== 'string') throw new Error('invalid_apple_token_record');
                const refreshToken = await decryptAppleRefreshToken(ctx.userId, typed);
                try {
                    await revokeAppleRefreshToken(typed.client_id, refreshToken);
                } catch (error) {
                    if (error instanceof AppleAuthorizationError && error.code === 'revoke_unusable') {
                        manualRevocationRequired = true;
                        const { error: manualMarkerError } = await ctx.service.rpc('mark_apple_refresh_token_manual_required', {
                            p_user_id: ctx.userId, p_client_id: typed.client_id,
                        });
                        if (manualMarkerError) throw manualMarkerError;
                        continue;
                    } else throw error;
                }
                const { error: markError } = await ctx.service.rpc('mark_apple_refresh_token_revoked', {
                    p_user_id: ctx.userId,
                    p_client_id: typed.client_id,
                });
                if (markError) throw new Error('apple_revocation_marker_failed');
            }
        } catch {
            // Never remove an Apple-linked auth user when stored authorization cannot be revoked.
            return json(503, { error: 'apple_revocation_failed' });
        }
        // Accounts created before this feature have no row. Apple revocation then
        // needs manual follow-up, but account deletion itself must remain possible.
        const { error } = await ctx.service.auth.admin.deleteUser(ctx.userId, false);
        if (error) return json(500, { error: 'account_deletion_failed' });
        return json(200, { deleted: true, ...(manualRevocationRequired ? { apple_revocation: 'manual_required' } : {}) });
    }
    const { error } = await ctx.service.auth.admin.deleteUser(ctx.userId, false);
    if (error) return json(500, { error: 'account_deletion_failed' });
    return json(200, { deleted: true });
});
