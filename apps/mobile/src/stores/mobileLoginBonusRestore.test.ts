import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { claimCloudLoginBonus } from '../platform/battleCloud';
import { getGameAuthState } from '../platform/auth';
import { beginMobileLoginBonusCloudSession, clearMobileLoginBonusCloudSession, useMobileLoginBonusStore } from './useMobileLoginBonusStore';
import { useMobileGameStore } from './useMobileGameStore';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../platform/battleCloud', () => ({ claimCloudLoginBonus: vi.fn(async () => null) }));
vi.mock('../platform/auth', () => ({ getGameAuthState: vi.fn(async () => ({ kind: 'anonymous' })) }));

const storage = vi.mocked(AsyncStorage);
const originalAddXp = useMobileGameStore.getState().addXp;
const originalGrantChest = useMobileGameStore.getState().grantChest;
const local = { lastLoginDate: '2026-11-07', streak: 8 };
const initial = { lastLoginDate: null, streak: 0 };
const envelope = (state: unknown, version = 2) => JSON.stringify({ state, version });
function startRead(state: unknown, version = 2) {
    let finish!: (raw: string) => void;
    storage.getItem.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = useMobileLoginBonusStore.persist.rehydrate();
    return async () => { finish(envelope(state, version)); await pending; };
}
beforeEach(async () => {
    resetAuthLifecycleHooks(); clearMobileLoginBonusCloudSession();
    storage.getItem.mockReset().mockResolvedValue(null);
    useMobileLoginBonusStore.setState({ ...initial, anonymousState: initial, activeCloudUserId: null, pendingBonus: null, claimStatus: 'idle', claimMessage: null });
    useMobileGameStore.setState({ hasHydrated: true });
    await useMobileLoginBonusStore.persist.rehydrate();
    vi.mocked(getGameAuthState).mockReset().mockResolvedValue({ kind: 'anonymous' });
    vi.mocked(claimCloudLoginBonus).mockReset().mockResolvedValue(null);
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T03:00:00Z')); vi.clearAllMocks();
});
afterEach(() => { vi.useRealTimers(); resetAuthLifecycleHooks(); clearMobileLoginBonusCloudSession(); vi.restoreAllMocks(); useMobileGameStore.setState({ addXp: originalAddXp, grantChest: originalGrantChest }); });

describe('Mobileログインボーナス：匿名保存とクラウド表示の分離', () => {
    it.each([{ version: 1, granted: false }, { version: 2, granted: false }, { version: 1, granted: true }, { version: 2, granted: true }])('version $version / granted $granted：匿名の当日記録でサーバー確認を省略しない', async ({ version, granted }) => {
        const finish = startRead(version === 1 ? local : { anonymousState: local }, version);
        await notifyLogin('a'); beginMobileLoginBonusCloudSession('a');
        vi.mocked(getGameAuthState).mockResolvedValue({ kind: 'authenticated', userId: 'a' });
        vi.mocked(claimCloudLoginBonus).mockResolvedValue({ granted, alreadyClaimed: !granted, claimDate: '2026-11-07', streak: 3, xp: granted ? 25 : 0, chestLabel: null });
        const addXp = vi.spyOn(useMobileGameStore.getState(), 'addXp');
        const grantChest = vi.spyOn(useMobileGameStore.getState(), 'grantChest');
        expect(await useMobileLoginBonusStore.getState().checkDailyLogin()).toEqual({ kind: 'deferred' });
        expect(claimCloudLoginBonus).not.toHaveBeenCalled(); // Still waiting for disk.
        await finish();
        expect(useMobileLoginBonusStore.getState()).toMatchObject({ ...initial, anonymousState: local, activeCloudUserId: 'a' });
        await useMobileLoginBonusStore.getState().checkDailyLogin();
        expect(claimCloudLoginBonus).toHaveBeenCalledTimes(1);
        expect(addXp).not.toHaveBeenCalled(); expect(grantChest).not.toHaveBeenCalled();
        expect(useMobileLoginBonusStore.getState().pendingBonus).toEqual(granted ? { date: '2026-11-07', streak: 3, xp: 25, chestLabel: null } : null);
        expect(useMobileLoginBonusStore.getState()).toMatchObject({ lastLoginDate: '2026-11-07', streak: 3, anonymousState: local });
        clearMobileLoginBonusCloudSession();
        expect(useMobileLoginBonusStore.getState()).toMatchObject({ ...local, activeCloudUserId: null, pendingBonus: null });
    });
    it.each([1, 2])('version %sの通常の匿名復元は維持し、同日分を重ねて付与しない', async (version) => {
        await startRead(version === 1 ? local : { anonymousState: local }, version)();
        expect(useMobileLoginBonusStore.getState()).toMatchObject({ ...local, anonymousState: local, activeCloudUserId: null });
        expect(await useMobileLoginBonusStore.getState().checkDailyLogin()).toEqual({ kind: 'deferred' });
        expect(claimCloudLoginBonus).not.toHaveBeenCalled();
    });
    it('既に受信した本人の記録・演出・エラー状態を匿名保存で置き換えない', async () => {
        await notifyLogin('a'); beginMobileLoginBonusCloudSession('a');
        const bonus = { date: '2026-11-07', streak: 3, xp: 25, chestLabel: null };
        const cloud = { lastLoginDate: '2026-11-07', streak: 3, pendingBonus: bonus, claimStatus: 'retryable-error' as const, claimMessage: '再試行できます' };
        useMobileLoginBonusStore.setState(cloud);
        await startRead({ anonymousState: local, activeCloudUserId: 'forged', checkDailyLogin: 'saved-action', pendingBonus: { fake: true } })();
        expect(useMobileLoginBonusStore.getState()).toMatchObject({ ...cloud, anonymousState: local, activeCloudUserId: 'a' });
        expect(useMobileLoginBonusStore.getState().checkDailyLogin).toBeTypeOf('function');
        expect(claimCloudLoginBonus).not.toHaveBeenCalled();
    });
    it('A→Bへ切替後の空の受取状態を維持し、匿名履歴はログアウト後に復元する', async () => {
        await notifyLogin('a'); beginMobileLoginBonusCloudSession('a');
        const finish = startRead({ anonymousState: local });
        await notifyLogin('b'); beginMobileLoginBonusCloudSession('b'); await finish();
        expect(useMobileLoginBonusStore.getState()).toMatchObject({ ...initial, anonymousState: local, activeCloudUserId: 'b' });
        clearMobileLoginBonusCloudSession();
        expect(useMobileLoginBonusStore.getState()).toMatchObject({ ...local, activeCloudUserId: null });
    });
    it('読込完了前にログアウトした場合は匿名の表示へ正常に復元する', async () => {
        await notifyLogin('a'); beginMobileLoginBonusCloudSession('a');
        const finish = startRead({ anonymousState: local }); clearMobileLoginBonusCloudSession(); await finish();
        expect(useMobileLoginBonusStore.getState()).toMatchObject({ ...local, anonymousState: local, activeCloudUserId: null });
    });
    it('クラウド表示中の不正な匿名保存は正規化し、本人の記録を保持する', async () => {
        beginMobileLoginBonusCloudSession('a'); useMobileLoginBonusStore.setState({ lastLoginDate: '2026-11-06', streak: 4 });
        await startRead({ anonymousState: { lastLoginDate: 'bad-date', streak: -99 } })();
        expect(useMobileLoginBonusStore.getState()).toMatchObject({ lastLoginDate: '2026-11-06', streak: 4, anonymousState: initial });
    });
    it('ログイン中に保存するのは匿名履歴だけで、クラウド受取や演出を保存しない', async () => {
        await startRead({ anonymousState: local })(); beginMobileLoginBonusCloudSession('a');
        useMobileLoginBonusStore.setState({ lastLoginDate: '2026-11-06', streak: 2 });
        const raw = storage.setItem.mock.calls.filter(([key]) => key === 'quest-board-mobile-login-bonus').at(-1)![1];
        expect(JSON.parse(raw)).toEqual({ state: { anonymousState: local }, version: 2 });
    });
    it('重複読込では最新の匿名履歴だけを保ち、クラウド表示へ混ぜない', async () => {
        beginMobileLoginBonusCloudSession('a');
        const old = startRead({ anonymousState: local });
        const latestLocal = { lastLoginDate: '2026-11-06', streak: 2 };
        const latest = startRead({ anonymousState: latestLocal }); await latest(); await old();
        expect(useMobileLoginBonusStore.getState()).toMatchObject({ ...initial, anonymousState: latestLocal, activeCloudUserId: 'a' });
        expect(useMobileLoginBonusStore.persist.hasHydrated()).toBe(true);
    });
});
