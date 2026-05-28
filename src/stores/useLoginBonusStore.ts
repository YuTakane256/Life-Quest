import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LoginBonus, LoginBonusStoreState } from '../types';
import { LOGIN_BONUS_CONFIG } from '../config/gameConfig';
import { getTodayJST, shiftDate } from '../utils/dateUtils';
import { useGameStore } from './useGameStore';

/** 連続ログイン日数に応じた付与XPを算出（上限あり） */
function calculateBonusXp(streak: number): number {
    const xp = LOGIN_BONUS_CONFIG.BASE_XP + (streak - 1) * LOGIN_BONUS_CONFIG.XP_PER_STREAK_DAY;
    return Math.min(LOGIN_BONUS_CONFIG.MAX_XP, xp);
}

export const useLoginBonusStore = create<LoginBonusStoreState>()(
    persist(
        (set, get) => ({
            lastLoginDate: null,
            streak: 0,
            pendingBonus: null,

            checkDailyLogin: () => {
                const today = getTodayJST();
                const { lastLoginDate, streak } = get();

                // 今日分のボーナスは受け取り済み
                if (lastLoginDate === today) return;

                // 前日にログインしていれば連続日数を継続、そうでなければ1日目にリセット
                const isConsecutive = lastLoginDate === shiftDate(today, -1);
                const newStreak = isConsecutive ? streak + 1 : 1;

                const xp = calculateBonusXp(newStreak);
                const isSpecialDay = newStreak % LOGIN_BONUS_CONFIG.SPECIAL_CHEST_INTERVAL === 0;

                const bonus: LoginBonus = {
                    date: today,
                    streak: newStreak,
                    xp,
                    chestLabel: isSpecialDay ? LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL : null,
                };

                // ★ 順序重要 ★
                // 報酬付与より先に lastLoginDate を today にコミットする。こうしておくと、
                // タブ複数 / visibility 復帰などで本関数が同フレームに再呼び出しされても、
                // 2 回目以降は上の `lastLoginDate === today` で即 return し、
                // XP / 特別宝箱が二重付与されることがない。
                set({ lastLoginDate: today, streak: newStreak, pendingBonus: bonus });

                // 報酬を付与する
                const gameStore = useGameStore.getState();
                gameStore.addXp(xp);
                if (isSpecialDay) {
                    gameStore.grantChest(
                        LOGIN_BONUS_CONFIG.SPECIAL_CHEST_TYPE,
                        LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL
                    );
                }
            },

            clearPendingBonus: () => set({ pendingBonus: null }),
        }),
        {
            name: 'quest-board-login-bonus',
            // pendingBonus は表示用の一時状態なので永続化しない
            partialize: (state) => ({
                lastLoginDate: state.lastLoginDate,
                streak: state.streak,
            }),
        }
    )
);
