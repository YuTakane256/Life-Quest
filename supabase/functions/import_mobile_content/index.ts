/**
 * import_mobile_content（#506 フローB / ADR-011）。
 *
 * ユーザーが確認UIで承認したMobile固有のタスク・習慣のみを統合する。
 * Web初回移行（imported_at）が未完了ならDB関数が web_migration_required で拒否する。
 * unique(user_id, client_id) により複数回の統合試行でも重複しない。
 */
import { buildMobileContentPayload } from '../../../packages/core/src/cloudImport.ts';
import { BadRequestError, callApply, requireString, serveGameFunction } from '../_shared/handler.ts';

serveGameFunction(async (ctx) => {
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');
    const content = ctx.body.content;
    if (typeof content !== 'object' || content === null || Array.isArray(content)) {
        throw new BadRequestError('invalid_content');
    }

    const payload = buildMobileContentPayload(content as {
        tasks?: unknown; habits?: unknown; dailyRecords?: unknown;
    });

    return callApply(ctx.service, 'import_mobile_content_apply', {
        p_user_id: ctx.userId,
        p_payload: payload,
        p_key: idempotencyKey,
    });
});
