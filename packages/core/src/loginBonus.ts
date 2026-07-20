/**
 * デイリーログインボーナスの計算ロジック（Web/Mobile/Edge Function共有）。
 *
 * 元はWeb専用のuseLoginBonusStore.tsにあった計算ロジックを、サーバー側
 * （claim_login_bonus Edge Function）でも同一のstreak/XP算出が必要になった
 * ためcoreへ移設した。streakはクライアントの自己申告を信用せず、サーバーが
 * characters.login_streak/last_login_bonus_dateから独立に算出する
 * （claim_habit_bonusがクライアントの「全部達成した」を信用しないのと同じ方針）。
 */
import { shiftDate } from './dates.ts';
import type { ChestType } from './rewards.ts';

export const LOGIN_BONUS_CONFIG = {
    /** ログインボーナスの基本XP（連続1日目） */
    BASE_XP: 20,
    /** 連続ログイン1日ごとに加算されるXP */
    XP_PER_STREAK_DAY: 5,
    /** 1回のログインボーナスで付与されるXPの上限 */
    MAX_XP: 100,
    /** 特別宝箱を付与する連続ログイン日数の周期（7日ごと） */
    SPECIAL_CHEST_INTERVAL: 7,
    /** 特別宝箱のタイプ */
    SPECIAL_CHEST_TYPE: 'gold' satisfies ChestType,
    /** 特別宝箱のラベル */
    SPECIAL_CHEST_LABEL: '7日連続ログイン記念の金の宝箱',
} as const;

export interface LoginBonusResult {
    streak: number;
    xp: number;
    isSpecialDay: boolean;
}

/** 連続ログイン日数に応じた付与XPを算出（上限あり） */
export function calculateLoginBonusXp(streak: number): number {
    const xp = LOGIN_BONUS_CONFIG.BASE_XP + (streak - 1) * LOGIN_BONUS_CONFIG.XP_PER_STREAK_DAY;
    return Math.min(LOGIN_BONUS_CONFIG.MAX_XP, xp);
}

/**
 * 今日分のログインボーナスを計算する。lastDate/prevStreakは直近の付与状態、
 * todayは呼び出し元が用意するJSTの今日（Web: getTodayJST、EF: core/dates.ts
 * のgetTodayJst）。今日分は受取済み（lastDate >= today）ならnullを返す。
 */
export function computeLoginBonus(
    lastDate: string | null,
    prevStreak: number,
    today: string,
): LoginBonusResult | null {
    if (lastDate !== null && lastDate >= today) return null;

    // 前日にログインしていれば連続日数を継続、そうでなければ1日目にリセット
    const isConsecutive = lastDate === shiftDate(today, -1);
    const streak = isConsecutive ? prevStreak + 1 : 1;
    const xp = calculateLoginBonusXp(streak);
    const isSpecialDay = streak % LOGIN_BONUS_CONFIG.SPECIAL_CHEST_INTERVAL === 0;

    return { streak, xp, isSpecialDay };
}
