/**
 * complete_subtask（#502）。サブタスク完了はXPが親タスク優先度の半分（core共有ルール）。
 * gacha_count加算・マイルストーン対象になる点はWeb現行と同一。
 * 全サブタスク完了時はDB関数が親タスクを自動完了し、親の報酬も同一トランザクションで
 * 連鎖させる（親XP・親分のマイルストーン候補はここで算出して渡す）。
 */
import { getTodayJst } from '../../../packages/core/src/dates.ts';
import { getSubtaskRewardXp, type Priority } from '../../../packages/core/src/tasks.ts';
import { XP_CONFIG } from '../../../packages/core/src/progression.ts';
import { callApply, NotFoundError, requireString, serveGameFunction } from '../_shared/handler.ts';

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

    const { data: parent, error: parentError } = await ctx.service.from('tasks')
        .select('priority')
        .eq('id', subtask.task_id)
        .eq('user_id', ctx.userId)
        .single<{ priority: Priority }>();
    if (parentError || !parent) throw new NotFoundError();
    const priority: Priority = parent.priority;

    return callApply(ctx.service, 'complete_subtask_apply', {
        p_user_id: ctx.userId,
        p_subtask_id: subtaskId,
        p_xp: getSubtaskRewardXp(priority),
        p_date: getTodayJst(),
        p_parent_xp: XP_CONFIG.REWARD_BY_PRIORITY[priority] ?? XP_CONFIG.REWARD_BY_PRIORITY.medium,
        p_key: idempotencyKey,
    });
});
