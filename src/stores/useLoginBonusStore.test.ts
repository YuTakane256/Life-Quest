import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoginBonusStore } from './useLoginBonusStore';
import { useGameStore } from './useGameStore';
import { LOGIN_BONUS_CONFIG } from '../config/gameConfig';

/** JST 基準で "今日" を固定する: jstDate の 12:00 JST = UTC 03:00 */
function setToday(jstDate: string) {
    vi.setSystemTime(new Date(`${jstDate}T03:00:00Z`));
}

function resetStore() {
    localStorage.clear();
    useLoginBonusStore.setState({ lastLoginDate: null, streak: 0, pendingBonus: null });
}

describe('useLoginBonusStore.checkDailyLogin', () => {
    let addXpSpy: ReturnType<typeof vi.spyOn>;
    let grantChestSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        setToday('2025-03-15');
        resetStore();
        // useGameStore の副作用をスパイ（実体は呼ばせるが検証可能に）
        addXpSpy = vi.spyOn(useGameStore.getState(), 'addXp').mockImplementation(() => undefined);
        grantChestSpy = vi.spyOn(useGameStore.getState(), 'grantChest').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('初回ログイン: streak=1, xp=BASE_XP, pendingBonus 設定, addXp 呼び出し', () => {
        useLoginBonusStore.getState().checkDailyLogin();
        const state = useLoginBonusStore.getState();
        expect(state.streak).toBe(1);
        expect(state.lastLoginDate).toBe('2025-03-15');
        expect(state.pendingBonus).toMatchObject({
            date: '2025-03-15',
            streak: 1,
            xp: LOGIN_BONUS_CONFIG.BASE_XP,
            chestLabel: null,
        });
        expect(addXpSpy).toHaveBeenCalledWith(LOGIN_BONUS_CONFIG.BASE_XP);
        expect(grantChestSpy).not.toHaveBeenCalled();
    });

    it('同日 2 回目呼び出し: 何も変化しない', () => {
        useLoginBonusStore.getState().checkDailyLogin();
        const stateAfter1 = useLoginBonusStore.getState();
        useLoginBonusStore.getState().checkDailyLogin();
        const stateAfter2 = useLoginBonusStore.getState();
        expect(stateAfter2.streak).toBe(stateAfter1.streak);
        expect(stateAfter2.lastLoginDate).toBe(stateAfter1.lastLoginDate);
        // addXp は最初の 1 回だけ
        expect(addXpSpy).toHaveBeenCalledTimes(1);
    });

    it('前日にログイン済みなら streak がインクリメントする', () => {
        useLoginBonusStore.setState({ lastLoginDate: '2025-03-14', streak: 1, pendingBonus: null });
        useLoginBonusStore.getState().checkDailyLogin();
        const state = useLoginBonusStore.getState();
        expect(state.streak).toBe(2);
        // xp = BASE_XP + (2 - 1) * XP_PER_STREAK_DAY
        const expected = LOGIN_BONUS_CONFIG.BASE_XP + LOGIN_BONUS_CONFIG.XP_PER_STREAK_DAY;
        expect(state.pendingBonus?.xp).toBe(expected);
        expect(addXpSpy).toHaveBeenCalledWith(expected);
    });

    it('2 日空けて呼ぶと streak: 1 にリセット', () => {
        // 2 日前にログイン
        useLoginBonusStore.setState({ lastLoginDate: '2025-03-13', streak: 5, pendingBonus: null });
        useLoginBonusStore.getState().checkDailyLogin();
        expect(useLoginBonusStore.getState().streak).toBe(1);
        expect(addXpSpy).toHaveBeenCalledWith(LOGIN_BONUS_CONFIG.BASE_XP);
    });

    it('7 日目: 特別宝箱が grantChest される', () => {
        useLoginBonusStore.setState({ lastLoginDate: '2025-03-14', streak: 6, pendingBonus: null });
        useLoginBonusStore.getState().checkDailyLogin();
        expect(useLoginBonusStore.getState().streak).toBe(LOGIN_BONUS_CONFIG.SPECIAL_CHEST_INTERVAL);
        expect(grantChestSpy).toHaveBeenCalledWith(
            LOGIN_BONUS_CONFIG.SPECIAL_CHEST_TYPE,
            LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL,
        );
        expect(useLoginBonusStore.getState().pendingBonus?.chestLabel).toBe(LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL);
    });

    it('14 日目（特別宝箱周期の倍数）でも grantChest される', () => {
        useLoginBonusStore.setState({ lastLoginDate: '2025-03-14', streak: 13, pendingBonus: null });
        useLoginBonusStore.getState().checkDailyLogin();
        expect(useLoginBonusStore.getState().streak).toBe(14);
        expect(grantChestSpy).toHaveBeenCalledTimes(1);
    });

    it('xp は MAX_XP でクランプされる（streak が非常に大きい場合）', () => {
        // streak 100 → BASE + 99 * PER = 20 + 495 = 515 → MAX 100 にクランプ
        useLoginBonusStore.setState({ lastLoginDate: '2025-03-14', streak: 99, pendingBonus: null });
        useLoginBonusStore.getState().checkDailyLogin();
        expect(useLoginBonusStore.getState().pendingBonus?.xp).toBe(LOGIN_BONUS_CONFIG.MAX_XP);
        expect(addXpSpy).toHaveBeenCalledWith(LOGIN_BONUS_CONFIG.MAX_XP);
    });

    it('clearPendingBonus は pendingBonus のみ null にする', () => {
        useLoginBonusStore.getState().checkDailyLogin();
        const before = useLoginBonusStore.getState();
        expect(before.pendingBonus).not.toBeNull();
        useLoginBonusStore.getState().clearPendingBonus();
        const after = useLoginBonusStore.getState();
        expect(after.pendingBonus).toBeNull();
        // lastLoginDate / streak は保持
        expect(after.lastLoginDate).toBe(before.lastLoginDate);
        expect(after.streak).toBe(before.streak);
    });
});
