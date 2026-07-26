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
    const expectedUserId = typeof ctx.body.expectedUserId === 'string' ? ctx.body.expectedUserId : null;
    // 所有者はJWTのctx.userIdだけで確定する。これはリクエスト中の別アカウントへの
    // 切替を、報酬RPCを実行する前に検出するための照合値であり、旧クライアントでは省略可。
    if (expectedUserId !== null && expectedUserId !== ctx.userId) return json(409, { error: 'auth_user_mismatch' });

    // 同じキーの再送は、日付の既受領判定より先に最初の確定結果を返す。レスポンス
    // 消失後でも granted/xp/chest を同じ内容で再生し、演出とクライアント状態を安全に
    // 収束させる。台帳はservice_role専用で、必ずJWT由来のctx.userIdで絞り込む。
    const { data: replay, error: replayError } = await ctx.service
        .from('idempotency_keys')
        .select('operation, result')
        .eq('user_id', ctx.userId)
        .eq('key', idempotencyKey)
        .maybeSingle<{ operation: string; result: unknown | null }>();
    if (replayError) return json(500, { error: replayError.message });
    if (replay?.operation === 'claim_login_bonus' && replay.result !== null) return json(200, replay.result);

    const today = getTodayJst();

    const { data: character, error } = await ctx.service
        .from('characters')
        .select('login_streak, last_login_bonus_date, version')
        .eq('user_id', ctx.userId)
        .single<{ login_streak: number; last_login_bonus_date: string | null; version: number }>();
    if (error || !character) return json(500, { error: error?.message ?? 'character not found' });

    const bonus = computeLoginBonus(character.last_login_bonus_date, character.login_streak, today);
    if (!bonus) {
        // 同日の別端末請求や再送は失敗ではなく、確定済みのサーバー状態を返す。
        return json(200, {
            granted: false,
            already_claimed: true,
            claim_date: character.last_login_bonus_date ?? today,
            streak: character.login_streak,
            xp: 0,
            chest_label: null,
            version: character.version,
        });
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
