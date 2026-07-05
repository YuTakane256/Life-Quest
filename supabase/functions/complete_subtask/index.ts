/**
 * complete_subtask（#502）。サブタスク完了はXPが親タスク優先度の半分（core共有ルール）。
 * gacha_count加算・マイルストーン対象になる点はWeb現行と同一。
 */
import { getSubtaskRewardXp, type Priority } from '../../../packages/core/src/tasks.ts';
import { callApply, NotFoundError, requireString, serveGameFunction } from '../_shared/handler.ts';
import { computeNextMilestoneChest } from '../_shared/game.ts';

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

    const { data: parent } = await ctx.service
        .from('tasks')
        .select('priority')
        .eq('id', subtask.task_id)
        .eq('user_id', ctx.userId)
        .single<{ priority: Priority }>();
    const priority: Priority = parent?.priority ?? 'medium';

    const xp = getSubtaskRewardXp(priority);
    const chest = await computeNextMilestoneChest(ctx);

    return callApply(ctx.service, 'complete_subtask_apply', {
        p_user_id: ctx.userId,
        p_subtask_id: subtaskId,
        p_xp: xp,
        p_chest: chest,
        p_key: idempotencyKey,
    });
});
