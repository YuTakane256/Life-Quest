/**
 * delete_account (#516)。対象ユーザーは必ずJWTから決定する。
 * bodyのuserId等は一切読まず、成功時だけauth.usersを物理削除してFK cascadeを発火する。
 */
import { json, serveGameFunction } from '../_shared/handler.ts';

serveGameFunction(async (ctx) => {
    const { error } = await ctx.service.auth.admin.deleteUser(ctx.userId, false);
    if (error) return json(500, { error: 'account_deletion_failed' });
    return json(200, { deleted: true });
});
