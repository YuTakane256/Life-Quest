/**
 * open_chest（#502）。開封結果の装備はcore rollEquipmentTemplateでサーバーが抽選する。
 * スターター宝箱の開封によるバトル解放はDB関数が適用する。
 */
import { rollEquipmentTemplate, type ChestType } from '../../../packages/core/src/rewards.ts';
import { callApply, json, NotFoundError, requireString, serveGameFunction } from '../_shared/handler.ts';

serveGameFunction(async (ctx) => {
    const chestId = requireString(ctx.body, 'chestId');
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');

    const { data: chest, error } = await ctx.service
        .from('chests')
        .select('id, chest_type, opened')
        .eq('id', chestId)
        .eq('user_id', ctx.userId)
        .is('deleted_at', null)
        .single<{ id: string; chest_type: ChestType; opened: boolean }>();
    if (error || !chest) throw new NotFoundError();
    if (chest.opened) return json(409, { error: 'chest_already_opened' });

    // blue（スターター）宝箱は装備を排出せずnullを返す（core共有ルール）
    const template = rollEquipmentTemplate(chest.chest_type);

    return callApply(ctx.service, 'open_chest_apply', {
        p_user_id: ctx.userId,
        p_chest_id: chestId,
        p_item: template ? { id: crypto.randomUUID(), template_id: template.id } : null,
        p_key: idempotencyKey,
    });
});
