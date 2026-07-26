/**
 * Mobile版デイリーログインボーナスのテスト。Web `useLoginBonusStore.test.ts`のミラー。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudLoginBonusResult } from '@life-quest/core/gameCloud';

const memory = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => { memory.set(key, value); }),
        removeItem: vi.fn(async (key: string) => { memory.delete(key); }),
    },
}));

vi.mock('../platform/battleCloud', () => ({
    claimCloudLoginBonus: vi.fn(async (): Promise<CloudLoginBonusResult | null> => null),
}));

vi.mock('../platform/auth', () => ({
    getGameAuthState: vi.fn(async () => ({ kind: 'anonymous' })),
}));

import {
    beginMobileLoginBonusCloudSession,
    clearMobileLoginBonusCloudSession,
    useMobileLoginBonusStore,
} from './useMobileLoginBonusStore';
import { useMobileGameStore } from './useMobileGameStore';
import { LOGIN_BONUS_CONFIG } from '@life-quest/core/loginBonus';
import { claimCloudLoginBonus } from '../platform/battleCloud';
import { getGameAuthState } from '../platform/auth';

const claimCloudLoginBonusMock = vi.mocked(claimCloudLoginBonus);
const getGameAuthStateMock = vi.mocked(getGameAuthState);

// JST 2025-03-15 12:00:00 に固定
const BASE_DATE = new Date('2025-03-15T03:00:00.000Z'); // UTC 03:00 = JST 12:00

/** checkDailyLoginは内部でクラウド請求をawaitする非同期処理のため、マイクロタスクを十分にフラッシュする。 */
async function flushAsync(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}

let addXpSpy: ReturnType<typeof vi.fn>;
let grantChestSpy: ReturnType<typeof vi.fn>;
const originalAddXp = useMobileGameStore.getState().addXp;
const originalGrantChest = useMobileGameStore.getState().grantChest;

function reset(fakeDate: Date = BASE_DATE) {
    memory.clear();
    useMobileLoginBonusStore.setState({ lastLoginDate: null, streak: 0, pendingBonus: null });
    addXpSpy = vi.fn();
    grantChestSpy = vi.fn();
    useMobileGameStore.setState({
        addXp: addXpSpy as unknown as typeof originalAddXp,
        grantChest: grantChestSpy as unknown as typeof originalGrantChest,
        hasHydrated: true,
    });
    claimCloudLoginBonusMock.mockReset();
    claimCloudLoginBonusMock.mockResolvedValue(null);
    getGameAuthStateMock.mockReset();
    getGameAuthStateMock.mockResolvedValue({ kind: 'anonymous' });
    vi.useFakeTimers();
    vi.setSystemTime(fakeDate);
}

describe('useMobileLoginBonusStore（ローカル経路、クラウド未接続）', () => {
    beforeEach(async () => {
        reset();
        await useMobileLoginBonusStore.persist.rehydrate();
    });

    afterEach(() => {
        vi.useRealTimers();
        useMobileGameStore.setState({ addXp: originalAddXp, grantChest: originalGrantChest });
    });

    it('初回ログイン: streak=1, xp=BASE_XP', async () => {
        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();
        const state = useMobileLoginBonusStore.getState();
        expect(state.streak).toBe(1);
        expect(state.lastLoginDate).toBe('2025-03-15');
        expect(state.pendingBonus).not.toBeNull();
        expect(state.pendingBonus!.xp).toBe(LOGIN_BONUS_CONFIG.BASE_XP);
        expect(addXpSpy).toHaveBeenCalledWith(LOGIN_BONUS_CONFIG.BASE_XP);
    });

    it('同日2回目呼び出し: 何も起きない', async () => {
        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();
        addXpSpy.mockClear();

        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();
        expect(addXpSpy).not.toHaveBeenCalled();
    });

    it('端末時計が保存済みログイン日より前に戻っても追加付与しない', async () => {
        useMobileLoginBonusStore.setState({ lastLoginDate: '2025-03-16', streak: 2, pendingBonus: null });

        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();

        expect(addXpSpy).not.toHaveBeenCalled();
        expect(claimCloudLoginBonusMock).not.toHaveBeenCalled();
        expect(useMobileLoginBonusStore.getState()).toMatchObject({
            lastLoginDate: '2025-03-16',
            streak: 2,
            pendingBonus: null,
        });
    });

    it('前日ログインありで翌日: streak=2', async () => {
        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();
        expect(useMobileLoginBonusStore.getState().streak).toBe(1);

        vi.setSystemTime(new Date('2025-03-16T03:00:00.000Z'));
        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();
        expect(useMobileLoginBonusStore.getState().streak).toBe(2);
    });

    it('2日空けて呼ぶ: streak=1にリセット', async () => {
        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();
        vi.setSystemTime(new Date('2025-03-17T03:00:00.000Z'));
        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();
        expect(useMobileLoginBonusStore.getState().streak).toBe(1);
    });

    it('7日目: grantChestが呼ばれる', async () => {
        for (let i = 0; i < 7; i++) {
            vi.setSystemTime(new Date(`2025-03-${String(15 + i).padStart(2, '0')}T03:00:00.000Z`));
            useMobileLoginBonusStore.getState().checkDailyLogin();
            await flushAsync();
        }
        expect(useMobileLoginBonusStore.getState().streak).toBe(7);
        expect(grantChestSpy).toHaveBeenCalledWith(
            LOGIN_BONUS_CONFIG.SPECIAL_CHEST_TYPE,
            LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL
        );
        expect(useMobileLoginBonusStore.getState().pendingBonus!.chestLabel).toBe(LOGIN_BONUS_CONFIG.SPECIAL_CHEST_LABEL);
    });

    it('MAX_XP上限: streakが大きい時にxpがクランプされる', async () => {
        const bigStreak = Math.ceil((LOGIN_BONUS_CONFIG.MAX_XP - LOGIN_BONUS_CONFIG.BASE_XP) / LOGIN_BONUS_CONFIG.XP_PER_STREAK_DAY) + 10;
        useMobileLoginBonusStore.setState({ lastLoginDate: '2025-03-14', streak: bigStreak - 1 });
        vi.setSystemTime(new Date('2025-03-15T03:00:00.000Z'));
        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();
        expect(useMobileLoginBonusStore.getState().pendingBonus!.xp).toBe(LOGIN_BONUS_CONFIG.MAX_XP);
    });

    it('clearPendingBonus: pendingBonusだけnullになる', async () => {
        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();
        expect(useMobileLoginBonusStore.getState().pendingBonus).not.toBeNull();
        const { lastLoginDate, streak } = useMobileLoginBonusStore.getState();

        useMobileLoginBonusStore.getState().clearPendingBonus();
        expect(useMobileLoginBonusStore.getState().pendingBonus).toBeNull();
        expect(useMobileLoginBonusStore.getState().lastLoginDate).toBe(lastLoginDate);
        expect(useMobileLoginBonusStore.getState().streak).toBe(streak);
    });

    it('rehydrate時に不正なlastLoginDateとstreakを安全化する', async () => {
        memory.set('quest-board-mobile-login-bonus', JSON.stringify({
            state: { lastLoginDate: '2025-02-29', streak: Number.POSITIVE_INFINITY, pendingBonus: { date: 'x', streak: 99, xp: 999, chestLabel: 'unexpected' } },
            version: 1,
        }));

        await useMobileLoginBonusStore.persist.rehydrate();

        expect(useMobileLoginBonusStore.getState()).toMatchObject({
            lastLoginDate: null,
            streak: 0,
            pendingBonus: null,
        });
    });

    it('rehydrate時に巨大なstreakを10年分までに丸める', async () => {
        memory.set('quest-board-mobile-login-bonus', JSON.stringify({
            state: { lastLoginDate: '2025-03-14', streak: 999999 },
            version: 1,
        }));

        await useMobileLoginBonusStore.persist.rehydrate();

        expect(useMobileLoginBonusStore.getState()).toMatchObject({
            lastLoginDate: '2025-03-14',
            streak: 3650,
            pendingBonus: null,
        });
    });
});

describe('useMobileLoginBonusStore（クラウド経路）', () => {
    beforeEach(async () => {
        reset();
        await useMobileLoginBonusStore.persist.rehydrate();
    });

    afterEach(() => {
        vi.useRealTimers();
        useMobileGameStore.setState({ addXp: originalAddXp, grantChest: originalGrantChest });
    });

    it('granted: trueならサーバーのstreak/xp/chestLabelをそのまま反映し、ローカル付与はしない', async () => {
        getGameAuthStateMock.mockResolvedValue({ kind: 'authenticated', userId: 'user-1' });
        claimCloudLoginBonusMock.mockResolvedValue({ granted: true, alreadyClaimed: false, claimDate: '2025-03-15', streak: 4, xp: 35, chestLabel: null });

        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();

        expect(claimCloudLoginBonusMock).toHaveBeenCalledTimes(1);
        expect(addXpSpy).not.toHaveBeenCalled();
        expect(grantChestSpy).not.toHaveBeenCalled();
        const state = useMobileLoginBonusStore.getState();
        expect(state.lastLoginDate).toBe('2025-03-15');
        expect(state.streak).toBe(4);
        expect(state.pendingBonus).toEqual({ date: '2025-03-15', streak: 4, xp: 35, chestLabel: null });
    });

    it('granted: falseなら演出を出さず、日付とstreakだけ進める', async () => {
        getGameAuthStateMock.mockResolvedValue({ kind: 'authenticated', userId: 'user-1' });
        claimCloudLoginBonusMock.mockResolvedValue({ granted: false, alreadyClaimed: true, claimDate: '2025-03-15', streak: 3, xp: 0, chestLabel: null });

        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();

        expect(addXpSpy).not.toHaveBeenCalled();
        const state = useMobileLoginBonusStore.getState();
        expect(state.lastLoginDate).toBe('2025-03-15');
        expect(state.streak).toBe(3);
        expect(state.pendingBonus).toBeNull();
    });

    it('認証済みのクラウド接続エラーではローカル報酬へフォールバックしない', async () => {
        getGameAuthStateMock.mockResolvedValue({ kind: 'authenticated', userId: 'user-1' });
        claimCloudLoginBonusMock.mockRejectedValue(new Error('network error'));

        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();

        expect(addXpSpy).not.toHaveBeenCalled();
        const state = useMobileLoginBonusStore.getState();
        expect(state.streak).toBe(0);
        expect(state.pendingBonus).toBeNull();
        expect(state.claimStatus).toBe('retryable-error');
    });

    it('ゲームストアのhydration完了前は請求もローカル付与も行わない', async () => {
        useMobileGameStore.setState({ hasHydrated: false });

        await expect(useMobileLoginBonusStore.getState().checkDailyLogin()).resolves.toEqual({ kind: 'deferred' });

        expect(claimCloudLoginBonusMock).not.toHaveBeenCalled();
        expect(addXpSpy).not.toHaveBeenCalled();
        expect(useMobileLoginBonusStore.getState().lastLoginDate).toBeNull();
    });

    it('認証ライフサイクルの隔離は匿名状態を残し、クラウド演出と失敗表示を消す', () => {
        useMobileLoginBonusStore.setState({
            activeCloudUserId: 'user-a',
            lastLoginDate: '2025-03-15',
            streak: 4,
            pendingBonus: { date: '2025-03-15', streak: 4, xp: 35, chestLabel: null },
            claimStatus: 'retryable-error',
            claimMessage: '通信を確認してください。',
            anonymousState: { lastLoginDate: '2025-03-12', streak: 2 },
        });

        clearMobileLoginBonusCloudSession();
        expect(useMobileLoginBonusStore.getState()).toMatchObject({
            activeCloudUserId: null, lastLoginDate: '2025-03-12', streak: 2,
            pendingBonus: null, claimStatus: 'idle', claimMessage: null,
        });

        beginMobileLoginBonusCloudSession('user-b');
        expect(useMobileLoginBonusStore.getState()).toMatchObject({
            activeCloudUserId: 'user-b', lastLoginDate: null, streak: 0, pendingBonus: null,
        });
    });

    it('請求中の復帰再確認は失敗後に一度だけ再実行する', async () => {
        getGameAuthStateMock.mockResolvedValue({ kind: 'authenticated', userId: 'user-1' });
        let rejectClaim!: (error: Error) => void;
        claimCloudLoginBonusMock
            .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectClaim = reject; }))
            .mockResolvedValueOnce({ granted: false, alreadyClaimed: true, claimDate: '2025-03-15', streak: 2, xp: 0, chestLabel: null });

        const first = useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();
        void useMobileLoginBonusStore.getState().checkDailyLogin();
        rejectClaim(new Error('offline'));

        await first;
        await flushAsync();
        expect(claimCloudLoginBonusMock).toHaveBeenCalledTimes(2);
        expect(useMobileLoginBonusStore.getState()).toMatchObject({
            claimStatus: 'idle', lastLoginDate: '2025-03-15', streak: 2,
        });
    });

    it('今日分は受取済みならクラウド請求もしない', async () => {
        useMobileLoginBonusStore.setState({ lastLoginDate: '2025-03-15', streak: 1 });

        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();

        expect(claimCloudLoginBonusMock).not.toHaveBeenCalled();
    });
});
