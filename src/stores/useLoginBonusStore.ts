import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GameStoreState, LoginBonus, LoginBonusStoreState } from '../types';
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

type GameRewardSnapshot = Pick<
    GameStoreState,
    | 'character'
    | 'debuff'
    | 'equipment'
    | 'gachaCount'
    | 'chestQueue'
    | 'battle'
    | 'levelUpEvent'
    | 'pendingChestReveal'
>;

function captureGameRewardState(): GameRewardSnapshot {
    const state = useGameStore.getState();
    return {
        character: state.character,
        debuff: state.debuff,
        equipment: state.equipment,
        gachaCount: state.gachaCount,
        chestQueue: state.chestQueue,
        battle: state.battle,
        levelUpEvent: state.levelUpEvent,
        pendingChestReveal: state.pendingChestReveal,
    };
}

function restoreGameRewardState(snapshot: GameRewardSnapshot): void {
    useGameStore.setState(snapshot);
}

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

                    // 今日分は受取済み。端末時計が過去へ戻った場合も、保存済みの
                    // 日付に追いつくまでは追加報酬を付与しない。
                    if (lastLoginDate !== null && lastLoginDate >= today) return;

                    // 前日にログインしていれば連続日数を継続、そうでなければ1日目にリセット
                    const isConsecutive = lastLoginDate === shiftDate(today, -1);
                    const newStreak = isConsecutive ? streak + 1 : 1;

                    const xp = calculateBonusXp(newStreak);
                    const isSpecialDay = newStreak % LOGIN_BONUS_CONFIG.SPECIAL_CHEST_INTERVAL === 0;

                    const gameSnapshot = captureGameRewardState();
                    const gameStore = useGameStore.getState();
                    const bonus: LoginBonus = {
                        date: today,
                        streak: newStreak,
                        xp,
                        chestLabel: isSpecialDay ? LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL : null,
                    };

                    try {
                        gameStore.addXp(xp);
                        if (isSpecialDay) {
                            gameStore.grantChest(
                                LOGIN_BONUS_CONFIG.SPECIAL_CHEST_TYPE,
                                LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL
                            );
                        }
                        set({ lastLoginDate: today, streak: newStreak, pendingBonus: bonus });
                    } catch (error) {
                        try {
                            restoreGameRewardState(gameSnapshot);
                            set({ lastLoginDate, streak, pendingBonus: null });
                        } catch {
                            // Storage自体が利用不能でも、元の付与エラーを優先して返す。
                        }
                        throw error;
                    }
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
