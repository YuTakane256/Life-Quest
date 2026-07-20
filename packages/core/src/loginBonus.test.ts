import { describe, expect, it } from 'vitest';
import { calculateLoginBonusXp, computeLoginBonus, LOGIN_BONUS_CONFIG } from './loginBonus.ts';

describe('calculateLoginBonusXp', () => {
    it('1日目はBASE_XP', () => {
        expect(calculateLoginBonusXp(1)).toBe(LOGIN_BONUS_CONFIG.BASE_XP);
    });

    it('streakごとにXP_PER_STREAK_DAYずつ増える', () => {
        expect(calculateLoginBonusXp(2)).toBe(LOGIN_BONUS_CONFIG.BASE_XP + LOGIN_BONUS_CONFIG.XP_PER_STREAK_DAY);
        expect(calculateLoginBonusXp(3)).toBe(LOGIN_BONUS_CONFIG.BASE_XP + LOGIN_BONUS_CONFIG.XP_PER_STREAK_DAY * 2);
    });

    it('MAX_XPで上限に達する', () => {
        expect(calculateLoginBonusXp(1000)).toBe(LOGIN_BONUS_CONFIG.MAX_XP);
    });
});

describe('computeLoginBonus', () => {
    it('初回ログイン（lastDate=null）はstreak=1', () => {
        const result = computeLoginBonus(null, 0, '2026-07-20');
        expect(result).toEqual({ streak: 1, xp: LOGIN_BONUS_CONFIG.BASE_XP, isSpecialDay: false });
    });

    it('前日ログインなら連続日数を継続する', () => {
        const result = computeLoginBonus('2026-07-19', 3, '2026-07-20');
        expect(result?.streak).toBe(4);
    });

    it('前日ログインでなければstreakを1にリセットする', () => {
        const result = computeLoginBonus('2026-07-10', 5, '2026-07-20');
        expect(result?.streak).toBe(1);
    });

    it('今日分は受取済み（lastDate >= today）ならnullを返す', () => {
        expect(computeLoginBonus('2026-07-20', 3, '2026-07-20')).toBeNull();
        expect(computeLoginBonus('2026-07-21', 3, '2026-07-20')).toBeNull();
    });

    it('SPECIAL_CHEST_INTERVALの倍数のstreakでisSpecialDay: trueになる', () => {
        const result = computeLoginBonus('2026-07-19', 6, '2026-07-20');
        expect(result).toEqual({ streak: 7, xp: calculateLoginBonusXp(7), isSpecialDay: true });
    });

    it('SPECIAL_CHEST_INTERVALの倍数でないstreakはisSpecialDay: false', () => {
        const result = computeLoginBonus('2026-07-19', 5, '2026-07-20');
        expect(result?.isSpecialDay).toBe(false);
    });
});
