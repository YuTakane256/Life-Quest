/**
 * synthesize_items（#502）。同一レアリティ素材（core SYNTHESIS_CONFIG.REQUIRED_COUNT点）→上位レアリティ1点。
 * 素材検証（同一レアリティ・非装備）と結果抽選はcoreの共有ルールで行い、
 * DB関数は所有・非装備・未削除の最終検証とトランザクション適用を担う。
 */
import {
    createEquipmentFromTemplate,
    selectSynthesisIngredients,
    type Equipment,
} from '../../../packages/core/src/equipment.ts';
import { EQUIPMENT_POOL, SYNTHESIS_CONFIG } from '../../../packages/core/src/rewards.ts';
import { BadRequestError, callApply, json, serveGameFunction, requireString } from '../_shared/handler.ts';

serveGameFunction(async (ctx) => {
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');
    const itemIds = ctx.body.itemIds;
    if (!Array.isArray(itemIds) || itemIds.length !== SYNTHESIS_CONFIG.REQUIRED_COUNT
        || itemIds.some((id) => typeof id !== 'string')) {
        throw new BadRequestError('invalid ingredients: wrong count');
    }

    const { data: rows, error } = await ctx.service
        .from('inventory_items')
        .select('id, template_id, equipped')
        .eq('user_id', ctx.userId)
        .in('id', itemIds as string[])
        .is('deleted_at', null);
    if (error) return json(500, { error: error.message });

    const inventory: Equipment[] = (rows ?? []).flatMap((row) => {
        const template = EQUIPMENT_POOL.find((candidate) => candidate.id === row.template_id);
        if (!template) return [];
        const item = createEquipmentFromTemplate(row.id, template);
        return [{ ...item, equipped: row.equipped }];
    });

    // core共有ルール: 同一レアリティ5点・非装備・上位レアリティ存在の検証
    const selection = selectSynthesisIngredients(itemIds as string[], inventory, SYNTHESIS_CONFIG.REQUIRED_COUNT);
    if (!selection) return json(409, { error: 'invalid ingredients: synthesis rules not satisfied' });

    const slot = selection.dominantSlots[Math.floor(Math.random() * selection.dominantSlots.length)];
    const candidates = EQUIPMENT_POOL.filter(
        (template) => template.rarity === selection.nextRarity && template.slot === slot,
    );
    if (candidates.length === 0) return json(409, { error: 'no synthesis candidates' });
    const resultTemplate = candidates[Math.floor(Math.random() * candidates.length)];

    return callApply(ctx.service, 'synthesize_items_apply', {
        p_user_id: ctx.userId,
        p_ingredient_ids: itemIds,
        p_result_item: { id: crypto.randomUUID(), template_id: resultTemplate.id },
        p_key: idempotencyKey,
    });
});
