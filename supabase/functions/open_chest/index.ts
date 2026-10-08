/**
 * open_chest（#502）。開封結果の装備はcore rollEquipmentTemplateでサーバーが抽選する。
 * スターター宝箱の開封によるバトル解放はDB関数が適用する。
 */
import { rollEquipmentTemplate, type ChestType } from '../../../packages/core/src/rewards.ts';
import { callApply, json, NotFoundError, requireString, serveGameFunction, type HandlerContext } from '../_shared/handler.ts';

export async function openChest(ctx: HandlerContext): Promise<Response> {
    const chestId = requireString(ctx.body, 'chestId');
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');

    // 開封済み判定より先に、JWT所有者の確定結果を再生する。
    const readReplay = async (): Promise<Response | null> => {
        const { data: replay, error: replayError } = await ctx.service
            .from('idempotency_keys')
            .select('operation, result')
            .eq('user_id', ctx.userId)
            .eq('key', idempotencyKey)
            .maybeSingle<{ operation: string; result: unknown | null }>();
        if (replayError) return json(500, { error: replayError.message });
        if (replay && replay.operation !== 'open_chest') {
            return json(409, { error: 'idempotency_key_operation_mismatch' });
        }
        if (replay && replay.result !== null) return json(200, replay.result);
        return null;
    };
    const replay = await readReplay();
    if (replay) return replay;

    const { data: chest, error } = await ctx.service
        .from('chests')
        .select('id, chest_type, opened')
        .eq('id', chestId)
        .eq('user_id', ctx.userId)
        .is('deleted_at', null)
        .single<{ id: string; chest_type: ChestType; opened: boolean }>();
    if (error || !chest || chest.opened) {
        // 最初のmiss後、並行開封が確定した場合も同じ結果を返す。
        const concurrentReplay = await readReplay();
        if (concurrentReplay) return concurrentReplay;
        if (error || !chest) throw new NotFoundError();
        return json(409, { error: 'chest_already_opened' });
    }

    // blue（スターター）宝箱は装備を排出せずnullを返す（core共有ルール）
    const template = rollEquipmentTemplate(chest.chest_type);

    return callApply(ctx.service, 'open_chest_apply', {
        p_user_id: ctx.userId,
        p_chest_id: chestId,
        p_item: template ? { id: crypto.randomUUID(), template_id: template.id } : null,
        p_key: idempotencyKey,
    });
}

serveGameFunction(openChest);
