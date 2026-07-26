import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createWebPersistStorage } from '../platform/storage';
import type { GameStoreState, LoginBonus, LoginBonusLocalState, LoginBonusStoreState } from '../types';
import { LOGIN_BONUS_CONFIG } from '../config/gameConfig';
import { getTodayJST, isValidYmd, shiftDate } from '../utils/dateUtils';
import { useGameStore } from './useGameStore';
import { calculateLoginBonusXp } from '@life-quest/core/loginBonus';
import { claimCloudLoginBonus } from '../platform/gameCloud';
import { getGameAuthState } from '../platform/auth';
import {
    getLoginBonusClaimMessage,
    requestLoginBonusClaim,
    type LoginBonusClaimResult,
} from '@life-quest/core/loginBonusPolicy';

const MAX_PERSISTED_STREAK = 3650;

let checkingPromise: Promise<LoginBonusClaimResult> | null = null;
let checkingGeneration = -1;
let claimGeneration = 0;
// 回復・foreground通知が請求中に重なった場合、完了後に1回だけ確認し直す。
let retryPending = false;

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

function sanitizeLocalState(raw: unknown): LoginBonusLocalState {
    const value = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const lastLoginDate = typeof value.lastLoginDate === 'string' && isValidYmd(value.lastLoginDate)
        ? value.lastLoginDate
        : null;
    const streak = typeof value.streak === 'number' && Number.isFinite(value.streak) && value.streak >= 0
        ? Math.min(MAX_PERSISTED_STREAK, Math.floor(value.streak))
        : 0;
    return { lastLoginDate, streak };
}

export const useLoginBonusStore = create<LoginBonusStoreState>()(
    persist(
        (set, get) => {
            /**
             * ローカル計算・ローカル付与のフォールバック経路（未接続時、または
             * クラウド接続エラー時）。エラー時に無条件でここへ落とすのは
             * `useCloudBattleStart`と同じ方針: 仮に実際にはサーバー側で成功して
             * いた場合でも、次回pullのサーバー正（total_xp/chests丸ごと上書き）
             * で収束するため、ローカル多重付与が永続化されることはない。
             */
            const runLocalBonus = (today: string): void => {
                const { lastLoginDate, streak } = get();

                // 前日にログインしていれば連続日数を継続、そうでなければ1日目にリセット
                const isConsecutive = lastLoginDate === shiftDate(today, -1);
                const newStreak = isConsecutive ? streak + 1 : 1;

                const xp = calculateLoginBonusXp(newStreak);
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

                    const work = (async (): Promise<LoginBonusClaimResult> => {
                        try {
                            const today = getTodayJST();
                            const authState = await getGameAuthState();
                            if (generation !== claimGeneration) return { kind: 'auth-changed' };

                            // 同一クラウドアカウントで今日のサーバー応答を既に適用済みなら、
                            // foreground/reconnect後の余分な請求を止める。
                            const current = get();
                            if (authState.kind === 'authenticated'
                                && current.activeCloudUserId === authState.userId
                                && current.lastLoginDate !== null
                                && current.lastLoginDate >= today) {
                                set({ claimStatus: 'idle', claimMessage: null });
                                return { kind: 'deferred' };
                            }

                            if (authState.kind === 'anonymous') {
                            // クラウドアカウントを表示していた場合だけ匿名用に戻す。匿名の
                            // 進行は別に保存するため、ログアウト後も以前のローカル利用を守る。
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
                            // A -> B の切替ではAの受領日をBの判定に使わない。匿名状態だけは保持する。
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
                                void useLoginBonusStore.getState().checkDailyLogin();
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
            name: 'quest-board-login-bonus',
            storage: createWebPersistStorage(),
            version: 2,
            migrate: (persisted) => persisted as LoginBonusStoreState,
            // pendingBonus は表示用の一時状態なので永続化しない
            partialize: (state) => ({
                // クラウドアカウントの受領状態はサーバーが正。匿名分だけ端末に保持する。
                anonymousState: state.activeCloudUserId === null
                    ? { lastLoginDate: state.lastLoginDate, streak: state.streak }
                    : state.anonymousState,
            }),
            merge: (persisted, current) => {
                const raw = (typeof persisted === 'object' && persisted !== null
                    ? (persisted as Record<string, unknown>)
                    : {});
                // v1の単一状態は匿名状態として移行する。旧クラウド状態を別アカウントへ
                // 流用しないため、ログイン後は必ずサーバー応答で置き換える。
                const anonymousState = sanitizeLocalState(raw.anonymousState ?? raw);
                return { ...current, ...anonymousState, anonymousState };
            },
        }
    )
);

/** 認証フック用: 別アカウントの受領状態・演出を即座に隔離する。 */
export function beginLoginBonusCloudSession(userId: string): void {
    const state = useLoginBonusStore.getState();
    if (state.activeCloudUserId === userId) return;
    claimGeneration++;
    const anonymousState = state.activeCloudUserId === null
        ? { lastLoginDate: state.lastLoginDate, streak: state.streak }
        : state.anonymousState;
    useLoginBonusStore.setState({
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
export function clearLoginBonusCloudSession(): void {
    claimGeneration++;
    const { anonymousState } = useLoginBonusStore.getState();
    useLoginBonusStore.setState({
        ...anonymousState,
        activeCloudUserId: null,
        pendingBonus: null,
        claimStatus: 'idle',
        claimMessage: null,
    });
}

/** 接続復帰などからの再確認要求。進行中なら完了後に一度だけ実行する。 */
export function requestLoginBonusRecheck(): void {
    void useLoginBonusStore.getState().checkDailyLogin();
}
