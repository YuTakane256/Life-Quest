import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import type { CloudLoginBonusResult } from '@life-quest/core/gameCloud';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), claim: vi.fn(), xp: vi.fn(), chest: vi.fn(), memory: new Map<string, string>() }));
vi.mock('../platform/auth', () => ({ getGameAuthState: mocks.auth }));
vi.mock('../../apps/mobile/src/platform/auth', () => ({ getGameAuthState: mocks.auth }));
vi.mock('../platform/gameCloud', () => ({ claimCloudLoginBonus: mocks.claim }));
vi.mock('../../apps/mobile/src/platform/battleCloud', () => ({ claimCloudLoginBonus: mocks.claim }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: async (key: string) => mocks.memory.get(key) ?? null,
    setItem: async (key: string, value: string) => { mocks.memory.set(key, value); },
    removeItem: async (key: string) => { mocks.memory.delete(key); },
} }));
import { useLoginBonusStore as web, beginLoginBonusCloudSession as beginWeb, clearLoginBonusCloudSession as clearWeb } from './useLoginBonusStore';
import { useMobileLoginBonusStore as mobile, beginMobileLoginBonusCloudSession as beginMobile, clearMobileLoginBonusCloudSession as clearMobile } from '../../apps/mobile/src/stores/useMobileLoginBonusStore';
import { useGameStore } from './useGameStore';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';

function deferred<T>() {
    let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function bonus(date = '2026-10-17'): CloudLoginBonusResult {
    return { granted: true, alreadyClaimed: false, claimDate: date, streak: 7, xp: 50, chestLabel: 'bonus' };
}
function bridge() {
    return registerAuthLifecycleHooks({ onLogin: (id) => { beginWeb(id); beginMobile(id); },
        onLogout: () => { clearWeb(); clearMobile(); } });
}
const originalWeb = { addXp: useGameStore.getState().addXp, grantChest: useGameStore.getState().grantChest };
const originalMobile = { addXp: useMobileGameStore.getState().addXp, grantChest: useMobileGameStore.getState().grantChest };
beforeEach(async () => {
    resetAuthLifecycleHooks(); clearWeb(); clearMobile(); localStorage.clear(); mocks.memory.clear();
    mocks.auth.mockReset().mockResolvedValue({ kind: 'authenticated', userId: 'a' });
    mocks.claim.mockReset().mockResolvedValue(bonus()); mocks.xp.mockReset(); mocks.chest.mockReset();
    const state = { lastLoginDate: null, streak: 0, pendingBonus: null, activeCloudUserId: null,
        anonymousState: { lastLoginDate: null, streak: 0 }, claimStatus: 'idle' as const, claimMessage: null };
    web.setState(state); mobile.setState(state); await mobile.persist.rehydrate();
    useGameStore.setState({ addXp: mocks.xp, grantChest: mocks.chest as typeof originalWeb.grantChest });
    useMobileGameStore.setState({ hasHydrated: true, addXp: mocks.xp, grantChest: mocks.chest as typeof originalMobile.grantChest });
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T14:59:59Z'));
    await notifyLogin('a'); beginWeb('a'); beginMobile('a');
});
afterEach(async () => {
    resetAuthLifecycleHooks(); clearWeb(); clearMobile(); await flush();
    useGameStore.setState(originalWeb); useMobileGameStore.setState(originalMobile); vi.useRealTimers();
});

describe.each([{ name: 'Web', store: web }, { name: 'Mobile', store: mobile }])('$nameのログインボーナス境界', ({ store, name }) => {
    it('予期しないSDK例外を秘匿して再試行を維持し、ローカル報酬を重ねない', async () => {
        const failure = Object.assign(new Error('private-auth-detail'), { details: 'private-auth-detail' });
        const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            mocks.auth.mockRejectedValueOnce(failure);
            expect(await store.getState().checkDailyLogin()).toEqual({ kind: 'retryable-error' });
            expect(report).toHaveBeenCalledOnce();
            expect(report.mock.calls[0]).not.toContain(failure);
            expect(JSON.stringify(report.mock.calls)).not.toContain('private-auth-detail');
            expect(store.getState().claimStatus).toBe('retryable-error');
            expect(mocks.claim).not.toHaveBeenCalled();
            expect(mocks.xp).not.toHaveBeenCalled(); expect(mocks.chest).not.toHaveBeenCalled();
            await store.getState().checkDailyLogin();
            expect(mocks.claim).toHaveBeenCalledOnce();
            expect(store.getState().pendingBonus).not.toBeNull();
        } finally { report.mockRestore(); }
    });
    it('同一スコープの連続確認は同じPromiseを共有し、同日成功後は再送しない', async () => {
        const response = deferred<CloudLoginBonusResult>(); mocks.claim.mockReturnValueOnce(response.promise);
        const first = store.getState().checkDailyLogin(); const second = store.getState().checkDailyLogin();
        expect(second).toBe(first); await flush(); expect(mocks.claim).toHaveBeenCalledTimes(1);
        response.resolve(bonus()); await first; await flush();
        expect(mocks.claim).toHaveBeenCalledTimes(1); expect(store.getState().lastLoginDate).toBe('2026-10-17');
        expect(mocks.xp).not.toHaveBeenCalled(); expect(mocks.chest).not.toHaveBeenCalled();
    });
    it('Bの前段フックが待機中でも、旧Aの応答を受領状態へ適用しない', async () => {
        const response = deferred<CloudLoginBonusResult>(); mocks.claim.mockReturnValueOnce(response.promise);
        const first = store.getState().checkDailyLogin(); await flush();
        const held = deferred<void>(); registerAuthLifecycleHooks({ onLogin: (id) => id === 'b' ? held.promise : undefined }); bridge();
        mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); const switching = notifyLogin('b');
        response.resolve(bonus()); expect(await first).toEqual({ kind: 'auth-changed' });
        expect(store.getState().lastLoginDate).toBeNull(); expect(store.getState().pendingBonus).toBeNull();
        expect(mocks.claim.mock.calls[0][2].isActive()).toBe(false);
        held.resolve(); await switching; await store.getState().checkDailyLogin();
        expect(store.getState().activeCloudUserId).toBe('b'); expect(mocks.claim.mock.calls[1][1]).toBe('b');
    });
    it('前段フック待ち中は認証SDKも呼ばず、完了後の再確認で新ユーザーを請求する', async () => {
        const held = deferred<void>(); registerAuthLifecycleHooks({ onLogin: (id) => id === 'b' ? held.promise : undefined }); bridge();
        mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); const switching = notifyLogin('b');
        const checking = store.getState().checkDailyLogin(); await flush();
        expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled();
        held.resolve(); await switching; await checking;
        await store.getState().checkDailyLogin(); expect(mocks.claim).toHaveBeenCalledTimes(1);
        expect(mocks.claim.mock.calls[0][1]).toBe('b');
    });
    it('古いAの請求が未完了でも、スコープの異なるBは別のPromiseで確認できる', async () => {
        const old = deferred<CloudLoginBonusResult>(); mocks.claim.mockReturnValueOnce(old.promise);
        const a = store.getState().checkDailyLogin(); await flush();
        // bonus専用フックの世代番号変更に依存せず、共有auth scopeだけでも分離する。
        mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b');
        const b = store.getState().checkDailyLogin(); expect(b).not.toBe(a); await b;
        expect(store.getState().activeCloudUserId).toBe('b'); expect(store.getState().pendingBonus?.date).toBe('2026-10-17');
        old.reject(new Error('old error')); expect(await a).toEqual({ kind: 'auth-changed' }); await flush();
        expect(store.getState().claimStatus).toBe('idle'); expect(store.getState().activeCloudUserId).toBe('b');
        expect(store.getState().pendingBonus?.date).toBe('2026-10-17');
    });
    it('旧セッションのfinallyから匿名報酬の再確認を開始しない', async () => {
        const response = deferred<CloudLoginBonusResult>(); mocks.claim.mockReturnValueOnce(response.promise);
        const first = store.getState().checkDailyLogin(); await flush();
        void store.getState().checkDailyLogin(); // 旧セッションのretryPending
        const held = deferred<void>(); registerAuthLifecycleHooks({ onLogout: () => held.promise });
        mocks.auth.mockResolvedValue({ kind: 'anonymous' }); const logout = notifyLogout();
        const authCalls = mocks.auth.mock.calls.length;
        response.reject(new Error('old offline')); expect(await first).toEqual({ kind: 'auth-changed' }); await flush();
        expect(mocks.auth).toHaveBeenCalledTimes(authCalls); expect(mocks.xp).not.toHaveBeenCalled();
        held.resolve(); await logout;
    });
    it('A→logout→Aでも古い成功・エラーを新しい請求に混入させない', async () => {
        bridge(); const old = deferred<CloudLoginBonusResult>(); const current = deferred<CloudLoginBonusResult>();
        mocks.claim.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        const a = store.getState().checkDailyLogin(); await flush();
        await notifyLogout(); await notifyLogin('a');
        const next = store.getState().checkDailyLogin(); expect(next).not.toBe(a); await flush();
        old.resolve(bonus('2026-10-16')); expect(await a).toEqual({ kind: 'auth-changed' });
        expect(store.getState().claimStatus).toBe('checking'); expect(store.getState().lastLoginDate).toBeNull();
        current.resolve(bonus()); await next;
        expect(store.getState().lastLoginDate).toBe('2026-10-17'); expect(store.getState().pendingBonus?.date).toBe('2026-10-17');
    });
    it('SDK主体が先にBへ切り替わってもAのスコープでは送信・状態変更しない', async () => {
        mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' });
        expect(await store.getState().checkDailyLogin()).toEqual({ kind: 'auth-changed' });
        expect(store.getState().activeCloudUserId).toBe('a'); expect(mocks.claim).not.toHaveBeenCalled();
    });
    it('認証済みスコープでSDKがanonymousになってもローカル報酬へ切り替えない', async () => {
        mocks.auth.mockResolvedValue({ kind: 'anonymous' });
        expect(await store.getState().checkDailyLogin()).toEqual({ kind: 'auth-changed' });
        expect(mocks.xp).not.toHaveBeenCalled(); expect(mocks.chest).not.toHaveBeenCalled();
    });
    it('同一ユーザー再通知を挟んだ再試行は同日・同じキーを使う', async () => {
        bridge(); mocks.claim.mockRejectedValueOnce(new Error('offline'));
        await store.getState().checkDailyLogin(); await notifyLogin('a'); await store.getState().retryDailyLogin();
        expect(mocks.claim.mock.calls.map(([key, owner]) => [key, owner])).toEqual([
            ['login-bonus:2026-10-17', 'a'], ['login-bonus:2026-10-17', 'a'],
        ]);
        expect(store.getState().claimStatus).toBe('idle');
    });
    it('JST日付またぎの再確認は新しい日のキーで一度だけ請求する', async () => {
        const old = deferred<CloudLoginBonusResult>(); mocks.claim.mockReturnValueOnce(old.promise).mockResolvedValueOnce(bonus('2026-10-18'));
        const first = store.getState().checkDailyLogin(); await flush();
        vi.setSystemTime(new Date('2026-10-17T15:00:01Z')); void store.getState().checkDailyLogin();
        old.resolve(bonus()); await first; await flush();
        expect(mocks.claim.mock.calls.map(([key]) => key)).toEqual(['login-bonus:2026-10-17', 'login-bonus:2026-10-18']);
        expect(store.getState().lastLoginDate).toBe('2026-10-18'); expect(store.getState().pendingBonus?.date).toBe('2026-10-18');
    });
    it('ローカル付与途中の認証切替後に、旧スナップショットを復元しない', async () => {
        await notifyLogout(); clearWeb(); clearMobile(); mocks.auth.mockResolvedValue({ kind: 'anonymous' });
        store.setState({ lastLoginDate: '2026-10-16', streak: 6, anonymousState: { lastLoginDate: '2026-10-16', streak: 6 } });
        mocks.xp.mockImplementationOnce(() => {
            void notifyLogin('b');
            useGameStore.setState((state) => ({ character: { ...state.character, totalXp: 999 } }));
            useMobileGameStore.setState((state) => ({ character: { ...state.character, totalXp: 999 } }));
        });
        expect(await store.getState().checkDailyLogin()).toEqual({ kind: 'auth-changed' });
        expect(mocks.chest).not.toHaveBeenCalled(); expect(store.getState().pendingBonus).toBeNull();
        expect(useGameStore.getState().character.totalXp).toBe(999); expect(useMobileGameStore.getState().character.totalXp).toBe(999);
    });
    it('復元通知中に認証が変わっても、新アカウントの受領日を旧値へ戻さない', async () => {
        await notifyLogout(); clearWeb(); clearMobile(); mocks.auth.mockResolvedValue({ kind: 'anonymous' });
        store.setState({ lastLoginDate: '2026-10-16', streak: 6, anonymousState: { lastLoginDate: '2026-10-16', streak: 6 } });
        let restoring = false;
        const unsubscribe = (name === 'Web' ? useGameStore : useMobileGameStore).subscribe(() => {
            if (!restoring) return;
            restoring = false; void notifyLogin('b');
            store.setState({ activeCloudUserId: 'b', lastLoginDate: '2026-10-10', streak: 99, pendingBonus: null });
        });
        try {
            mocks.xp.mockImplementationOnce(() => { restoring = true; throw new Error('save failed'); });
            expect(await store.getState().checkDailyLogin()).toEqual({ kind: 'auth-changed' });
            expect(store.getState()).toMatchObject({ activeCloudUserId: 'b', lastLoginDate: '2026-10-10', streak: 99 });
        } finally { unsubscribe(); }
    });
});
