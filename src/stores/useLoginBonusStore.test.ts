import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoginBonusStore } from './useLoginBonusStore';
import { useGameStore } from './useGameStore';
import { LOGIN_BONUS_CONFIG } from '../config/gameConfig';

// JST 2025-03-15 12:00:00 に固定
const BASE_DATE = new Date('2025-03-15T03:00:00.000Z'); // UTC 03:00 = JST 12:00

let addXpSpy: ReturnType<typeof vi.fn>;
let grantChestSpy: ReturnType<typeof vi.fn>;
const originalAddXp = useGameStore.getState().addXp;
const originalGrantChest = useGameStore.getState().grantChest;

function reset(fakeDate: Date = BASE_DATE) {
    localStorage.clear();
    useLoginBonusStore.setState({ lastLoginDate: null, streak: 0, pendingBonus: null });
    addXpSpy = vi.fn();
    grantChestSpy = vi.fn();
    useGameStore.setState({ addXp: addXpSpy as unknown as typeof originalAddXp, grantChest: grantChestSpy as unknown as typeof originalGrantChest });
    vi.useFakeTimers();
    vi.setSystemTime(fakeDate);
}

describe('useLoginBonusStore', () => {
    beforeEach(() => reset());

    afterEach(() => {
        vi.useRealTimers();
        useGameStore.setState({ addXp: originalAddXp, grantChest: originalGrantChest });
    });

    it('初回ログイン: streak=1, xp=BASE_XP', () => {
        useLoginBonusStore.getState().checkDailyLogin();
        const state = useLoginBonusStore.getState();
        expect(state.streak).toBe(1);
        expect(state.lastLoginDate).toBe('2025-03-15');
        expect(state.pendingBonus).not.toBeNull();
        expect(state.pendingBonus!.xp).toBe(LOGIN_BONUS_CONFIG.BASE_XP);
        expect(addXpSpy).toHaveBeenCalledWith(LOGIN_BONUS_CONFIG.BASE_XP);
    });

    it('同日 2 回目呼び出し: 何も起きない', () => {
        useLoginBonusStore.getState().checkDailyLogin();
        addXpSpy.mockClear();
        const bonusAfterFirst = useLoginBonusStore.getState().pendingBonus;

        useLoginBonusStore.getState().checkDailyLogin();
        expect(useLoginBonusStore.getState().pendingBonus).toEqual(bonusAfterFirst);
        expect(addXpSpy).not.toHaveBeenCalled();
    });

    it('報酬付与中に再入しても二重支払いしない', () => {
        addXpSpy.mockImplementation(() => {
            useLoginBonusStore.getState().checkDailyLogin();
        });

        useLoginBonusStore.getState().checkDailyLogin();

        expect(useLoginBonusStore.getState().streak).toBe(1);
        expect(useLoginBonusStore.getState().lastLoginDate).toBe('2025-03-15');
        expect(addXpSpy).toHaveBeenCalledTimes(1);
        expect(useLoginBonusStore.getState().pendingBonus).toMatchObject({
            date: '2025-03-15',
            streak: 1,
            xp: LOGIN_BONUS_CONFIG.BASE_XP,
        });
    });

    it('XP付与に失敗した場合は今日分を受け取り済みにしない', () => {
        addXpSpy.mockImplementation(() => {
            throw new Error('xp failed');
        });

        expect(() => useLoginBonusStore.getState().checkDailyLogin()).toThrow('xp failed');

        expect(useLoginBonusStore.getState()).toMatchObject({
            lastLoginDate: null,
            streak: 0,
            pendingBonus: null,
        });
    });

    it('特別宝箱付与に失敗した場合もログイン状態を確定しない', () => {
        useLoginBonusStore.setState({ lastLoginDate: '2025-03-14', streak: 6 });
        grantChestSpy.mockImplementation(() => {
            throw new Error('chest failed');
        });

        expect(() => useLoginBonusStore.getState().checkDailyLogin()).toThrow('chest failed');

        expect(useLoginBonusStore.getState()).toMatchObject({
            lastLoginDate: '2025-03-14',
            streak: 6,
            pendingBonus: null,
        });
        expect(addXpSpy).toHaveBeenCalledWith(
            LOGIN_BONUS_CONFIG.BASE_XP + 6 * LOGIN_BONUS_CONFIG.XP_PER_STREAK_DAY
        );
    });

    it('前日ログインありで翌日: streak=2', () => {
        // 1日目
        useLoginBonusStore.getState().checkDailyLogin();
        expect(useLoginBonusStore.getState().streak).toBe(1);

        // 翌日 (JST 2025-03-16)
        vi.setSystemTime(new Date('2025-03-16T03:00:00.000Z'));
        useLoginBonusStore.getState().checkDailyLogin();
        expect(useLoginBonusStore.getState().streak).toBe(2);
        expect(useLoginBonusStore.getState().lastLoginDate).toBe('2025-03-16');
    });

    it('2日空けて呼ぶ: streak=1 にリセット', () => {
        useLoginBonusStore.getState().checkDailyLogin();
        // 2日後 (JST 2025-03-17 — 3/16 をスキップ)
        vi.setSystemTime(new Date('2025-03-17T03:00:00.000Z'));
        useLoginBonusStore.getState().checkDailyLogin();
        expect(useLoginBonusStore.getState().streak).toBe(1);
    });

    it('7日目: grantChest が呼ばれる', () => {
        // 7日連続ログインをシミュレート
        for (let i = 0; i < 7; i++) {
            vi.setSystemTime(new Date(`2025-03-${String(15 + i).padStart(2, '0')}T03:00:00.000Z`));
            useLoginBonusStore.getState().checkDailyLogin();
        }
        expect(useLoginBonusStore.getState().streak).toBe(7);
        expect(grantChestSpy).toHaveBeenCalledWith(
            LOGIN_BONUS_CONFIG.SPECIAL_CHEST_TYPE,
            LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL
        );
        expect(useLoginBonusStore.getState().pendingBonus!.chestLabel).toBe(LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL);
    });

    it('14日目: 同様に特別宝箱', () => {
        for (let i = 0; i < 14; i++) {
            vi.setSystemTime(new Date(`2025-03-${String(15 + i).padStart(2, '0')}T03:00:00.000Z`));
            useLoginBonusStore.getState().checkDailyLogin();
        }
        expect(useLoginBonusStore.getState().streak).toBe(14);
        // grantChest は 7日目と14日目の計2回呼ばれる
        expect(grantChestSpy).toHaveBeenCalledTimes(2);
    });

    it('MAX_XP 上限: streak が大きい時に xp がクランプされる', () => {
        // streak を大きくして MAX_XP を超えるはずの状況を作る
        const bigStreak = Math.ceil((LOGIN_BONUS_CONFIG.MAX_XP - LOGIN_BONUS_CONFIG.BASE_XP) / LOGIN_BONUS_CONFIG.XP_PER_STREAK_DAY) + 10;
        useLoginBonusStore.setState({ lastLoginDate: '2025-03-14', streak: bigStreak - 1 });
        vi.setSystemTime(new Date('2025-03-15T03:00:00.000Z'));
        useLoginBonusStore.getState().checkDailyLogin();
        expect(useLoginBonusStore.getState().pendingBonus!.xp).toBe(LOGIN_BONUS_CONFIG.MAX_XP);
        expect(addXpSpy).toHaveBeenCalledWith(LOGIN_BONUS_CONFIG.MAX_XP);
    });

    it('clearPendingBonus: pendingBonus だけ null になる', () => {
        useLoginBonusStore.getState().checkDailyLogin();
        expect(useLoginBonusStore.getState().pendingBonus).not.toBeNull();
        const { lastLoginDate, streak } = useLoginBonusStore.getState();

        useLoginBonusStore.getState().clearPendingBonus();
        expect(useLoginBonusStore.getState().pendingBonus).toBeNull();
        expect(useLoginBonusStore.getState().lastLoginDate).toBe(lastLoginDate);
        expect(useLoginBonusStore.getState().streak).toBe(streak);
    });

    it('rehydrate 時に不正な lastLoginDate と streak を安全化し pendingBonus は復元しない', async () => {
        useLoginBonusStore.setState({ lastLoginDate: '2025-03-14', streak: 5, pendingBonus: null });

        localStorage.setItem('quest-board-login-bonus', JSON.stringify({
            state: {
                lastLoginDate: '2025-02-29',
                streak: Number.POSITIVE_INFINITY,
                pendingBonus: {
                    date: '2025-03-15',
                    streak: 99,
                    xp: 999,
                    chestLabel: 'unexpected',
                },
            },
            version: 1,
        }));

        await useLoginBonusStore.persist.rehydrate();

        expect(useLoginBonusStore.getState()).toMatchObject({
            lastLoginDate: null,
            streak: 0,
            pendingBonus: null,
        });
    });

    it('rehydrate 時に巨大な streak を10年分までに丸める', async () => {
        localStorage.setItem('quest-board-login-bonus', JSON.stringify({
            state: {
                lastLoginDate: '2025-03-14',
                streak: 999999,
            },
            version: 1,
        }));

        await useLoginBonusStore.persist.rehydrate();

        expect(useLoginBonusStore.getState()).toMatchObject({
            lastLoginDate: '2025-03-14',
            streak: 3650,
            pendingBonus: null,
        });
    });
});
