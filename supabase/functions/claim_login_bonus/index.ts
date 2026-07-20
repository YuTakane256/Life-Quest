/**
 * claim_login_bonus。デイリーログインボーナスをサーバー側で判定・付与する。
 * streakはクライアントの自己申告を信用せず、characters.login_streak/
 * last_login_bonus_dateからサーバーが独立に算出する
 * （claim_habit_bonusが「全部達成した」という自己申告を信用しないのと同じ方針）。
 */
import { getTodayJst } from '../../../packages/core/src/dates.ts';
import { computeLoginBonus, LOGIN_BONUS_CONFIG } from '../../../packages/core/src/loginBonus.ts';
import { callApply, json, requireString, serveGameFunction } from '../_shared/handler.ts';

serveGameFunction(async (ctx) => {
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');
    const today = getTodayJst();

    const { data: character, error } = await ctx.service
        .from('characters')
        .select('login_streak, last_login_bonus_date')
        .eq('user_id', ctx.userId)
        .single<{ login_streak: number; last_login_bonus_date: string | null }>();
    if (error || !character) return json(500, { error: error?.message ?? 'character not found' });

    const bonus = computeLoginBonus(character.last_login_bonus_date, character.login_streak, today);
    if (!bonus) {
        return json(409, { error: 'already_claimed_today' });
    }

    const chest = bonus.isSpecialDay
        ? {
            id: crypto.randomUUID(),
            chest_type: LOGIN_BONUS_CONFIG.SPECIAL_CHEST_TYPE,
            label: LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL,
        }
        : null;

    return callApply(ctx.service, 'claim_login_bonus_apply', {
        p_user_id: ctx.userId,
        p_date: today,
        p_xp: bonus.xp,
        p_streak: bonus.streak,
        p_chest: chest,
        p_key: idempotencyKey,
    });
});
