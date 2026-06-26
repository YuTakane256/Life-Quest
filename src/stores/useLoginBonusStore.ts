import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LoginBonus, LoginBonusStoreState } from '../types';
import { LOGIN_BONUS_CONFIG } from '../config/gameConfig';
import { getTodayJST, isValidYmd, shiftDate } from '../utils/dateUtils';
import { useGameStore } from './useGameStore';

const MAX_PERSISTED_STREAK = 3650;

/** 連続ログイン日数に応じた付与XPを算出（上限あり） */
function calculateBonusXp(streak: number): number {
    const xp = LOGIN_BONUS_CONFIG.BASE_XP + (streak - 1) * LOGIN_BONUS_CONFIG.XP_PER_STREAK_DAY;
    return Math.min(LOGIN_BONUS_CONFIG.MAX_XP, xp);
}

let isChecking = false;

export const useLoginBonusStore = create<LoginBonusStoreState>()(
    persist(
        (set, get) => ({
            lastLoginDate: null,
            streak: 0,
            pendingBonus: null,

            checkDailyLogin: () => {
                if (isChecking) return;
                isChecking = true;
                
                try {
                    const today = getTodayJST();
                    const { lastLoginDate, streak } = get();

                    // 今日分のボーナスは受け取り済み
                    if (lastLoginDate === today) return;

                    // 前日にログインしていれば連続日数を継続、そうでなければ1日目にリセット
                    const isConsecutive = lastLoginDate === shiftDate(today, -1);
                    const newStreak = isConsecutive ? streak + 1 : 1;

                    const xp = calculateBonusXp(newStreak);
                    const isSpecialDay = newStreak % LOGIN_BONUS_CONFIG.SPECIAL_CHEST_INTERVAL === 0;

                    // 報酬を付与する
                    const gameStore = useGameStore.getState();
                    gameStore.addXp(xp);
                    if (isSpecialDay) {
                        gameStore.grantChest(
                            LOGIN_BONUS_CONFIG.SPECIAL_CHEST_TYPE,
                            LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL
                        );
                    }

                    const bonus: LoginBonus = {
                        date: today,
                        streak: newStreak,
                        xp,
                        chestLabel: isSpecialDay ? LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL : null,
                    };

                    set({ lastLoginDate: today, streak: newStreak, pendingBonus: bonus });
                } finally {
                    isChecking = false;
                }
            },

            clearPendingBonus: () => set({ pendingBonus: null }),
        }),
        {
            name: 'quest-board-login-bonus',
            version: 1,
            // pendingBonus は表示用の一時状態なので永続化しない
            partialize: (state) => ({
                lastLoginDate: state.lastLoginDate,
                streak: state.streak,
            }),
            merge: (persisted, current) => {
                const raw = (typeof persisted === 'object' && persisted !== null
                    ? (persisted as Record<string, unknown>)
                    : {});
                // lastLoginDate は実在する YYYY-MM-DD 文字列 or null。それ以外は null にフォールバック
                const lastLoginDate =
                    typeof raw.lastLoginDate === 'string' && isValidYmd(raw.lastLoginDate)
                        ? raw.lastLoginDate
                        : null;
                // streak は 0 以上の有限整数。壊れた巨大値は10年分までに抑える。
                const streak =
                    typeof raw.streak === 'number' && Number.isFinite(raw.streak) && raw.streak >= 0
                        ? Math.min(MAX_PERSISTED_STREAK, Math.floor(raw.streak))
                        : 0;
                return { ...current, lastLoginDate, streak };
            },
        }
    )
);
