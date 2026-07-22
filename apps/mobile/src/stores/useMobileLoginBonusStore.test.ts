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

import { useMobileLoginBonusStore } from './useMobileLoginBonusStore';
import { useMobileGameStore } from './useMobileGameStore';
import { LOGIN_BONUS_CONFIG } from '@life-quest/core/loginBonus';
import { claimCloudLoginBonus } from '../platform/battleCloud';

const claimCloudLoginBonusMock = vi.mocked(claimCloudLoginBonus);

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
    vi.useFakeTimers();
    vi.setSystemTime(fakeDate);
}

describe('useMobileLoginBonusStore（ローカル経路、クラウド未接続）', () => {
    beforeEach(() => reset());

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
    beforeEach(() => reset());

    afterEach(() => {
        vi.useRealTimers();
        useMobileGameStore.setState({ addXp: originalAddXp, grantChest: originalGrantChest });
    });

    it('granted: trueならサーバーのstreak/xp/chestLabelをそのまま反映し、ローカル付与はしない', async () => {
        claimCloudLoginBonusMock.mockResolvedValue({ granted: true, streak: 4, xp: 35, chestLabel: null });

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
        claimCloudLoginBonusMock.mockResolvedValue({ granted: false, streak: 3, xp: 0, chestLabel: null });

        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();

        expect(addXpSpy).not.toHaveBeenCalled();
        const state = useMobileLoginBonusStore.getState();
        expect(state.lastLoginDate).toBe('2025-03-15');
        expect(state.streak).toBe(3);
        expect(state.pendingBonus).toBeNull();
    });

    it('クラウド接続エラー時はローカルへフォールバックする', async () => {
        claimCloudLoginBonusMock.mockRejectedValue(new Error('network error'));

        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();

        expect(addXpSpy).toHaveBeenCalledWith(LOGIN_BONUS_CONFIG.BASE_XP);
        const state = useMobileLoginBonusStore.getState();
        expect(state.streak).toBe(1);
        expect(state.pendingBonus).not.toBeNull();
    });

    it('今日分は受取済みならクラウド請求もしない', async () => {
        useMobileLoginBonusStore.setState({ lastLoginDate: '2025-03-15', streak: 1 });

        useMobileLoginBonusStore.getState().checkDailyLogin();
        await flushAsync();

        expect(claimCloudLoginBonusMock).not.toHaveBeenCalled();
    });
});
