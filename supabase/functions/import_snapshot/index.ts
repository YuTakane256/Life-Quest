/**
 * import_snapshot（#506 フローA / ADR-011）。
 *
 * Webの初回クラウド移行。ローカルスナップショットをcore buildImportPayloadで
 * サニタイズし、import_snapshot_apply が1トランザクションで取り込む。
 * platform='web' の強制・二重取り込み防止（imported_at）はDB関数が権威判定する。
 */
import { buildImportPayload, type ImportSnapshotInput } from '../../../packages/core/src/cloudImport.ts';
import { BadRequestError, callApply, requireString, serveGameFunction } from '../_shared/handler.ts';

serveGameFunction(async (ctx) => {
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');
    const platform = ctx.body.platform;
    if (platform !== 'web' && platform !== 'mobile') {
        throw new BadRequestError('invalid_platform');
    }
    const snapshot = ctx.body.snapshot;
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
        throw new BadRequestError('invalid_snapshot');
    }

    const payload = buildImportPayload(snapshot as ImportSnapshotInput);

    return callApply(ctx.service, 'import_snapshot_apply', {
        p_user_id: ctx.userId,
        p_platform: platform,
        p_payload: payload,
        p_key: idempotencyKey,
    });
});
