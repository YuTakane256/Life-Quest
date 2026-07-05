/**
 * complete_subtask（#502）。サブタスク完了はXPが親タスク優先度の半分（core共有ルール）。
 * gacha_count加算・マイルストーン対象になる点はWeb現行と同一。
 * 全サブタスク完了時はDB関数が親タスクを自動完了し、親の報酬も同一トランザクションで
 * 連鎖させる（親XP・親分のマイルストーン候補はここで算出して渡す）。
 */
import { getSubtaskRewardXp, type Priority } from '../../../packages/core/src/tasks.ts';
import { XP_CONFIG } from '../../../packages/core/src/progression.ts';
import { getMilestoneAtCount, GACHA_CONFIG } from '../../../packages/core/src/rewards.ts';
import { callApply, NotFoundError, requireString, serveGameFunction } from '../_shared/handler.ts';
import type { ChestParam } from '../_shared/game.ts';

function milestoneChestAt(count: number): ChestParam | null {
    const milestone = getMilestoneAtCount(count);
    if (!milestone) return null;
    return {
        id: crypto.randomUUID(),
        chest_type: milestone.chestType,
        label: milestone.label,
        is_starter_character: milestone.chestType === 'blue' && milestone.count === GACHA_CONFIG.MILESTONES[0].count,
        milestone_count: count,
    };
}

serveGameFunction(async (ctx) => {
    const subtaskId = requireString(ctx.body, 'subtaskId');
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');

    const { data: subtask, error } = await ctx.service
        .from('subtasks')
        .select('id, task_id')
        .eq('id', subtaskId)
        .eq('user_id', ctx.userId)
        .is('deleted_at', null)
        .single<{ id: string; task_id: string }>();
    if (error || !subtask) throw new NotFoundError();

    const [parentRes, characterRes] = await Promise.all([
        ctx.service.from('tasks')
            .select('priority')
            .eq('id', subtask.task_id)
            .eq('user_id', ctx.userId)
            .single<{ priority: Priority }>(),
        ctx.service.from('characters')
            .select('gacha_count')
            .eq('user_id', ctx.userId)
            .single<{ gacha_count: number }>(),
    ]);
    const priority: Priority = parentRes.data?.priority ?? 'medium';
    const gachaCount = Number(characterRes.data?.gacha_count ?? 0);

    return callApply(ctx.service, 'complete_subtask_apply', {
        p_user_id: ctx.userId,
        p_subtask_id: subtaskId,
        p_xp: getSubtaskRewardXp(priority),
        // サブタスク分（gacha+1）と、親自動完了が発生した場合の親分（gacha+2）の候補。
        // 実際に挿入するかは「加算後のgacha_count一致」でDBが最終判定する。
        p_chest: milestoneChestAt(gachaCount + 1),
        p_parent_xp: XP_CONFIG.REWARD_BY_PRIORITY[priority] ?? XP_CONFIG.REWARD_BY_PRIORITY.medium,
        p_parent_chest: milestoneChestAt(gachaCount + 2),
        p_key: idempotencyKey,
    });
});
