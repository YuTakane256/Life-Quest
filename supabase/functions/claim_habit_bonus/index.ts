/**
 * claim_habit_bonus（#502）。指定日の全習慣完了をサーバー側で独立に検証し、
 * ボーナスXP（core XP_CONFIG.HABIT_ALL_COMPLETE_BONUS）を日付単位で生涯1回付与する。
 */
import { XP_CONFIG } from '../../../packages/core/src/progression.ts';
import { areAllHabitsComplete, type Habit, type HabitDailyRecord } from '../../../packages/core/src/habits.ts';
import { BadRequestError, callApply, json, requireString, serveGameFunction } from '../_shared/handler.ts';

serveGameFunction(async (ctx) => {
    const date = requireString(ctx.body, 'date');
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestError('invalid_date');

    // クライアントの「全部達成した」という自己申告は信用せず、サーバーが検証する
    const [habitsRes, logsRes] = await Promise.all([
        ctx.service.from('habits')
            .select('id, name, category_id, created_at')
            .eq('user_id', ctx.userId)
            .is('deleted_at', null),
        ctx.service.from('habit_logs')
            .select('habit_id, date, completed, memo')
            .eq('user_id', ctx.userId)
            .eq('date', date)
            .is('deleted_at', null),
    ]);
    if (habitsRes.error || logsRes.error) {
        return json(500, { error: habitsRes.error?.message ?? logsRes.error?.message });
    }

    const habits: Habit[] = (habitsRes.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        categoryId: row.category_id,
        createdAt: row.created_at,
    }));
    const records: HabitDailyRecord[] = (logsRes.data ?? []).map((row) => ({
        habitId: row.habit_id,
        date: row.date,
        completed: row.completed,
        memo: row.memo,
    }));

    if (!areAllHabitsComplete(habits, records, date)) {
        return json(409, { error: 'habits_not_all_complete' });
    }

    return callApply(ctx.service, 'claim_habit_bonus_apply', {
        p_user_id: ctx.userId,
        p_date: date,
        p_xp: XP_CONFIG.HABIT_ALL_COMPLETE_BONUS,
        p_key: idempotencyKey,
    });
});
