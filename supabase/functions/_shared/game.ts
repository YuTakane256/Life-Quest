/**
 * ゲームルール計算の共有ヘルパー（ADR-002案B: coreを直接importして算出）。
 */
import { getMilestoneAtCount, GACHA_CONFIG } from '../../../packages/core/src/rewards.ts';
import type { HandlerContext } from './handler.ts';

export interface ChestParam {
    id: string;
    chest_type: string;
    label: string;
    is_starter_character: boolean;
    milestone_count: number;
}

/**
 * gacha_countが+1されたときに到達するマイルストーン宝箱を算出する。
 * 実際に挿入するかどうかはDB関数が「加算後のgacha_count一致」で最終判定する。
 */
export async function computeNextMilestoneChest(
    ctx: HandlerContext,
): Promise<ChestParam | null> {
    const { data, error } = await ctx.service
        .from('characters')
        .select('gacha_count')
        .eq('user_id', ctx.userId)
        .single();
    if (error || data === null) return null;

    const nextCount = Number(data.gacha_count) + 1;
    const milestone = getMilestoneAtCount(nextCount);
    if (!milestone) return null;

    return {
        id: crypto.randomUUID(),
        chest_type: milestone.chestType,
        label: milestone.label,
        is_starter_character: milestone.chestType === 'blue' && milestone.count === GACHA_CONFIG.MILESTONES[0].count,
        milestone_count: nextCount,
    };
}
