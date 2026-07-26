/**
 * Mobile版デイリーログインボーナス。Web `src/stores/useLoginBonusStore.ts`の移植。
 *
 * streakはクライアントの自己申告を信用せず、サーバー（`claim_login_bonus`）が
 * characters.login_streak/last_login_bonus_dateから独立に算出する。クラウド
 * 優先で請求する。匿名が確定した場合だけローカル計算・ローカル付与を許可し、
 * ログイン済みの通信失敗は再試行可能な状態として保持する。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getTodayJst, isValidYmd, shiftDate } from '@life-quest/core/dates';
import { calculateLoginBonusXp, LOGIN_BONUS_CONFIG } from '@life-quest/core/loginBonus';
import { claimCloudLoginBonus } from '../platform/battleCloud';
import { getGameAuthState } from '../platform/auth';
import { useMobileGameStore } from './useMobileGameStore';
import type { CharacterState, RewardLedger } from '@life-quest/core/gameState';
import type { Equipment } from '@life-quest/core/equipment';
import type { ChestReward } from '@life-quest/core/rewards';
import {
    getLoginBonusClaimMessage,
    requestLoginBonusClaim,
    type LoginBonusClaimResult,
} from '@life-quest/core/loginBonusPolicy';

const MAX_PERSISTED_STREAK = 3650;

let checkingPromise: Promise<LoginBonusClaimResult> | null = null;
let checkingGeneration = -1;
let claimGeneration = 0;
let retryPending = false;

export interface MobileLoginBonus {
    date: string; // YYYY-MM-DD (JST)
    streak: number;
    xp: number;
    chestLabel: string | null;
}

interface MobileLoginBonusStore {
    lastLoginDate: string | null;
    streak: number;
    pendingBonus: MobileLoginBonus | null;
    anonymousState: MobileLoginBonusLocalState;
    activeCloudUserId: string | null;
    claimStatus: MobileLoginBonusClaimStatus;
    claimMessage: string | null;
    checkDailyLogin: () => Promise<LoginBonusClaimResult>;
    retryDailyLogin: () => Promise<LoginBonusClaimResult>;
    clearPendingBonus: () => void;
}

interface MobileLoginBonusLocalState {
    lastLoginDate: string | null;
    streak: number;
}

type MobileLoginBonusClaimStatus = 'idle' | 'checking' | 'retryable-error' | 'auth-error' | 'unavailable' | 'rejected';

interface GameRewardSnapshot {
    character: CharacterState;
    equipment: Equipment[];
    gachaCount: number;
    chestQueue: ChestReward[];
    rewardLedger: RewardLedger;
    lastLevelUp: ReturnType<typeof useMobileGameStore.getState>['lastLevelUp'];
}

function captureGameRewardState(): GameRewardSnapshot {
    const state = useMobileGameStore.getState();
    return {
        character: state.character,
        equipment: state.equipment,
        gachaCount: state.gachaCount,
        chestQueue: state.chestQueue,
        rewardLedger: state.rewardLedger,
        lastLevelUp: state.lastLevelUp,
    };
}

function restoreGameRewardState(snapshot: GameRewardSnapshot): void {
    useMobileGameStore.setState(snapshot);
}

function sanitizeLocalState(raw: unknown): MobileLoginBonusLocalState {
    const value = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const lastLoginDate = typeof value.lastLoginDate === 'string' && isValidYmd(value.lastLoginDate)
        ? value.lastLoginDate
        : null;
    const streak = typeof value.streak === 'number' && Number.isFinite(value.streak) && value.streak >= 0
        ? Math.min(MAX_PERSISTED_STREAK, Math.floor(value.streak))
        : 0;
    return { lastLoginDate, streak };
}

export const useMobileLoginBonusStore = create<MobileLoginBonusStore>()(
    persist(
        (set, get) => {
            /**
             * ローカル計算・ローカル付与のフォールバック経路（未接続時、または
             * クラウド接続エラー時）。次回pullのサーバー正（total_xp/chests丸ごと
             * 上書き）で収束するため、ここでの多重付与が永続化されることはない。
             */
            const runLocalBonus = (today: string): void => {
                const { lastLoginDate, streak } = get();

                const isConsecutive = lastLoginDate === shiftDate(today, -1);
                const newStreak = isConsecutive ? streak + 1 : 1;

                const xp = calculateLoginBonusXp(newStreak);
                const isSpecialDay = newStreak % LOGIN_BONUS_CONFIG.SPECIAL_CHEST_INTERVAL === 0;

                const gameSnapshot = captureGameRewardState();
                const gameStore = useMobileGameStore.getState();
                const bonus: MobileLoginBonus = {
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
            };

            return {
                lastLoginDate: null,
                streak: 0,
                pendingBonus: null,
                anonymousState: { lastLoginDate: null, streak: 0 },
                activeCloudUserId: null,
                claimStatus: 'idle',
                claimMessage: null,

                checkDailyLogin: () => {
                    const generation = claimGeneration;
                    if (checkingPromise && checkingGeneration === generation) {
                        retryPending = true;
                        return checkingPromise;
                    }
                    // AsyncStorageの復元やゲームストアのhydrationより先に受取状態を
                    // 変更すると、遅れて復元された古い値がサーバー応答を上書きし得る。
                    if (!useMobileLoginBonusStore.persist.hasHydrated() || !useMobileGameStore.getState().hasHydrated) {
                        return Promise.resolve({ kind: 'deferred' });
                    }

                    const work = (async (): Promise<LoginBonusClaimResult> => {
                        try {
                            const today = getTodayJst();
                            const authState = await getGameAuthState();
                            if (generation !== claimGeneration) return { kind: 'auth-changed' };

                            const current = get();
                            if (authState.kind === 'authenticated'
                                && current.activeCloudUserId === authState.userId
                                && current.lastLoginDate !== null
                                && current.lastLoginDate >= today) {
                                set({ claimStatus: 'idle', claimMessage: null });
                                return { kind: 'deferred' };
                            }

                            if (authState.kind === 'anonymous') {
                            if (get().activeCloudUserId !== null) {
                                const anonymousState = get().anonymousState;
                                set({ ...anonymousState, activeCloudUserId: null, pendingBonus: null });
                            }
                            const { lastLoginDate } = get();
                            if (lastLoginDate !== null && lastLoginDate >= today) {
                                set({ claimStatus: 'idle', claimMessage: null });
                                return { kind: 'deferred' };
                            }
                            } else if (authState.kind === 'authenticated' && get().activeCloudUserId !== authState.userId) {
                            const state = get();
                            const anonymousState = state.activeCloudUserId === null
                                ? { lastLoginDate: state.lastLoginDate, streak: state.streak }
                                : state.anonymousState;
                            set({
                                anonymousState,
                                activeCloudUserId: authState.userId,
                                lastLoginDate: null,
                                streak: 0,
                                pendingBonus: null,
                            });
                        }

                            set({ claimStatus: 'checking', claimMessage: null });
                            const result = await requestLoginBonusClaim(
                            authState,
                            getGameAuthState,
                            (expectedUserId) => claimCloudLoginBonus(`login-bonus:${today}`, expectedUserId),
                            );
                            if (generation !== claimGeneration) return { kind: 'auth-changed' };

                            if (result.kind === 'local-eligible') {
                            runLocalBonus(today);
                            const state = get();
                            set({
                                anonymousState: { lastLoginDate: state.lastLoginDate, streak: state.streak },
                                claimStatus: 'idle',
                                claimMessage: null,
                            });
                            return result;
                        }
                            if (result.kind === 'cloud-granted' || result.kind === 'already-claimed') {
                            const { bonus } = result;
                            set({
                                lastLoginDate: bonus.claimDate,
                                streak: bonus.streak,
                                pendingBonus: result.kind === 'cloud-granted' ? {
                                    date: bonus.claimDate,
                                    streak: bonus.streak,
                                    xp: bonus.xp,
                                    chestLabel: bonus.chestLabel,
                                } : null,
                                claimStatus: 'idle',
                                claimMessage: null,
                            });
                            return result;
                        }
                            set({
                            claimStatus: result.kind === 'auth-changed'
                                ? 'auth-error'
                                : result.kind === 'deferred' ? 'idle' : result.kind,
                            claimMessage: getLoginBonusClaimMessage(result),
                        });
                            return result;
                        } catch (error) {
                            if (generation !== claimGeneration) return { kind: 'auth-changed' };
                            console.error('checkDailyLogin failed', error);
                            const result: LoginBonusClaimResult = { kind: 'retryable-error' };
                            set({ claimStatus: 'retryable-error', claimMessage: getLoginBonusClaimMessage(result) });
                            return result;
                        }
                    })();
                    checkingPromise = work;
                    checkingGeneration = generation;
                    void work.finally(() => {
                        if (checkingPromise === work) {
                            checkingPromise = null;
                            checkingGeneration = -1;
                            if (retryPending) {
                                retryPending = false;
                                void useMobileLoginBonusStore.getState().checkDailyLogin();
                            }
                        }
                    });
                    return work;
                },

                retryDailyLogin: () => get().checkDailyLogin(),

                clearPendingBonus: () => set({ pendingBonus: null }),
            };
        },
        {
            name: 'quest-board-mobile-login-bonus',
            storage: createJSONStorage(() => AsyncStorage),
            version: 2,
            migrate: (persisted) => persisted as MobileLoginBonusStore,
            // pendingBonus は表示用の一時状態なので永続化しない
            partialize: (state) => ({
                anonymousState: state.activeCloudUserId === null
                    ? { lastLoginDate: state.lastLoginDate, streak: state.streak }
                    : state.anonymousState,
            }),
            merge: (persisted, current) => {
                const raw = (typeof persisted === 'object' && persisted !== null
                    ? (persisted as Record<string, unknown>)
                    : {});
                const anonymousState = sanitizeLocalState(raw.anonymousState ?? raw);
                return { ...current, ...anonymousState, anonymousState };
            },
        }
    )
);

/** 認証フック用: 別アカウントの受領状態・演出を即座に隔離する。 */
export function beginMobileLoginBonusCloudSession(userId: string): void {
    const state = useMobileLoginBonusStore.getState();
    if (state.activeCloudUserId === userId) return;
    claimGeneration++;
    const anonymousState = state.activeCloudUserId === null
        ? { lastLoginDate: state.lastLoginDate, streak: state.streak }
        : state.anonymousState;
    useMobileLoginBonusStore.setState({
        anonymousState,
        activeCloudUserId: userId,
        lastLoginDate: null,
        streak: 0,
        pendingBonus: null,
        claimStatus: 'idle',
        claimMessage: null,
    });
}

/** 認証フック用: ログアウト時にクラウド表示を匿名の保存状態へ即時復帰する。 */
export function clearMobileLoginBonusCloudSession(): void {
    claimGeneration++;
    const { anonymousState } = useMobileLoginBonusStore.getState();
    useMobileLoginBonusStore.setState({
        ...anonymousState,
        activeCloudUserId: null,
        pendingBonus: null,
        claimStatus: 'idle',
        claimMessage: null,
    });
}

/** 接続復帰などからの再確認要求。進行中なら完了後に一度だけ実行する。 */
export function requestMobileLoginBonusRecheck(): void {
    void useMobileLoginBonusStore.getState().checkDailyLogin();
}
