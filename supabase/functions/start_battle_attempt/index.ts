/**
 * start_battle_attempt（#502 / ADR-010）。
 * 敵ステータスはcore BATTLE_CONFIGから、自キャラ実効ステータスはcharacters+装備から
 * サーバーが確定する。クライアントが送ってきたステータスは一切信用しない。
 * 進行ロック（stage <= max_cleared_stage + 1）はDB関数が権威検証する。
 */
import { getStageDefinition } from '../../../packages/core/src/battle.ts';
import { calculateLevel, CHARACTER_CONFIG } from '../../../packages/core/src/progression.ts';
import {
    calculateEffectiveEquipmentStats,
    createEquipmentFromTemplate,
    type Equipment,
} from '../../../packages/core/src/equipment.ts';
import { EQUIPMENT_POOL } from '../../../packages/core/src/rewards.ts';
import { BadRequestError, callApply, json, NotFoundError, requireString, serveGameFunction } from '../_shared/handler.ts';

serveGameFunction(async (ctx) => {
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');
    const stage = ctx.body.stage;
    if (typeof stage !== 'number' || !Number.isInteger(stage)) {
        throw new BadRequestError('invalid_stage');
    }

    const enemyDef = getStageDefinition(stage);
    if (!enemyDef) throw new BadRequestError('invalid_stage');

    const [characterRes, itemsRes] = await Promise.all([
        ctx.service.from('characters')
            .select('name, total_xp')
            .eq('user_id', ctx.userId)
            .single<{ name: string; total_xp: number }>(),
        ctx.service.from('inventory_items')
            .select('id, template_id')
            .eq('user_id', ctx.userId)
            .eq('equipped', true)
            .is('deleted_at', null),
    ]);
    if (characterRes.error || !characterRes.data) throw new NotFoundError('character_missing');
    if (itemsRes.error) return json(500, { error: itemsRes.error.message });

    // 実効ステータスをサーバーが独立に算出（core共有ルール）
    const level = calculateLevel(Number(characterRes.data.total_xp));
    const base = {
        baseAttack: CHARACTER_CONFIG.INITIAL_STATS.attack + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.attack,
        baseDefense: CHARACTER_CONFIG.INITIAL_STATS.defense + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.defense,
        baseMaxHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp,
    };
    const equipment: Equipment[] = (itemsRes.data ?? []).flatMap((row) => {
        const template = EQUIPMENT_POOL.find((candidate) => candidate.id === row.template_id);
        if (!template) return [];
        return [{ ...createEquipmentFromTemplate(row.id, template), equipped: true }];
    });
    const effective = calculateEffectiveEquipmentStats(base, equipment);

    return callApply(ctx.service, 'start_battle_attempt_apply', {
        p_user_id: ctx.userId,
        p_attempt_id: crypto.randomUUID(),
        p_stage: stage,
        p_enemy: {
            stage: enemyDef.stage,
            name: enemyDef.name,
            maxHp: enemyDef.hp,
            attack: enemyDef.attack,
            defense: enemyDef.defense,
            xpReward: enemyDef.xpReward,
        },
        p_player: {
            name: characterRes.data.name,
            level,
            attack: effective.attack,
            defense: effective.defense,
            maxHp: effective.maxHp,
        },
        p_key: idempotencyKey,
    });
});
