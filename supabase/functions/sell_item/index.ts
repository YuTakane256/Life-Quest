/**
 * sell_item（#502）。売却XPはcore SELL_XP_BY_RARITYから算出。
 * 装備中の売却拒否はDB関数が最終判定する。
 */
import { EQUIPMENT_POOL, SELL_XP_BY_RARITY } from '../../../packages/core/src/rewards.ts';
import { callApply, NotFoundError, requireString, serveGameFunction } from '../_shared/handler.ts';

serveGameFunction(async (ctx) => {
    const itemId = requireString(ctx.body, 'itemId');
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');

    const { data: item, error } = await ctx.service
        .from('inventory_items')
        .select('id, template_id')
        .eq('id', itemId)
        .eq('user_id', ctx.userId)
        .is('deleted_at', null)
        .single<{ id: string; template_id: string }>();
    if (error || !item) throw new NotFoundError();

    const template = EQUIPMENT_POOL.find((candidate) => candidate.id === item.template_id);
    if (!template) throw new NotFoundError('unknown_template');

    return callApply(ctx.service, 'sell_item_apply', {
        p_user_id: ctx.userId,
        p_item_id: itemId,
        p_xp: SELL_XP_BY_RARITY[template.rarity],
        p_key: idempotencyKey,
    });
});
