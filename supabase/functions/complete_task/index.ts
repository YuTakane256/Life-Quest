/**
 * complete_task（#502）。
 *
 * ADR-002案B: XP額・マイルストーン宝箱・繰り返し次回タスクを@life-quest/coreの
 * 共有ルールから算出し、DB関数 complete_task_apply がトランザクション内で
 * ADR-003ゲート（全副作用を台帳挿入成否で制御）とともに適用する。
 * ADR-007: user_id はJWTからのみ導出。
 */
import { getTodayJst } from '../../../packages/core/src/dates.ts';
import { XP_CONFIG } from '../../../packages/core/src/progression.ts';
import { buildNextRecurringTask, type Priority, type Recurrence, type Task } from '../../../packages/core/src/tasks.ts';
import { callApply, NotFoundError, requireString, serveGameFunction } from '../_shared/handler.ts';

interface TaskRow {
    id: string;
    name: string;
    due_date: string | null;
    priority: Priority;
    recurrence: Recurrence;
    tags: string[];
}

serveGameFunction(async (ctx) => {
    const taskId = requireString(ctx.body, 'taskId');
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');

    const { data: task, error } = await ctx.service
        .from('tasks')
        .select('id, name, due_date, priority, recurrence, tags')
        .eq('id', taskId)
        .eq('user_id', ctx.userId)
        .is('deleted_at', null)
        .single<TaskRow>();
    if (error || !task) throw new NotFoundError();

    const xp = XP_CONFIG.REWARD_BY_PRIORITY[task.priority] ?? XP_CONFIG.REWARD_BY_PRIORITY.medium;
    const today = getTodayJst();

    // 繰り返し次回分（coreの共有ルール。重複ガードの最終判定はDB側）
    let nextTaskParam: Record<string, unknown> | null = null;
    if (task.recurrence !== 'none') {
        const now = new Date().toISOString();
        const coreTask: Task = {
            id: task.id,
            name: task.name,
            dueDate: task.due_date,
            priority: task.priority,
            tags: task.tags ?? [],
            subtasks: [], // クラウドではsubtasksは別テーブル。次回分のサブタスク引き継ぎは#504で扱う
            recurrence: task.recurrence,
            completed: false,
            completedAt: null,
            createdAt: now,
        };
        const next = buildNextRecurringTask({
            task: coreTask,
            taskId: crypto.randomUUID(),
            subtaskIdFor: () => crypto.randomUUID(),
            now,
            today,
        });
        if (next) {
            nextTaskParam = {
                id: next.id,
                name: next.name,
                due_date: next.dueDate,
                priority: next.priority,
                recurrence: next.recurrence,
                tags: next.tags,
            };
        }
    }

    return callApply(ctx.service, 'complete_task_apply', {
        p_user_id: ctx.userId,
        p_task_id: taskId,
        p_xp: xp,
        p_date: today,
        p_next_task: nextTaskParam,
        p_key: idempotencyKey,
    });
});
