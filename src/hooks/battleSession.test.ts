import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import type { BattleAction } from '@life-quest/core/battle';

const mocks = vi.hoisted(() => ({
    auth: vi.fn(), start: vi.fn(), resolve: vi.fn(), localStart: vi.fn(), applyStart: vi.fn(), applyResolve: vi.fn(),
    webBattle: { status: 'idle', rewardMode: 'local', battleAttemptId: null as string | null,
        currentStage: 1, actions: [] as BattleAction[] },
    mobileBattle: null as null | { stage: number; rewardMode: string; battleAttemptId: string | null;
        state: { outcome: string }; actions: BattleAction[] },
}));
vi.mock('../platform/auth', () => ({ getBattleAuthState: mocks.auth, getGameAuthState: mocks.auth }));
vi.mock('../../apps/mobile/src/platform/auth', () => ({ getBattleAuthState: mocks.auth, getGameAuthState: mocks.auth }));
vi.mock('../platform/gameCloud', () => ({ startCloudBattleAttempt: mocks.start, resolveCloudBattleAttempt: mocks.resolve }));
vi.mock('../../apps/mobile/src/platform/battleCloud', () => ({ startCloudBattleAttempt: mocks.start, resolveCloudBattleAttempt: mocks.resolve }));
vi.mock('../stores/useGameStore', () => {
    const getState = () => ({ battle: mocks.webBattle, startBattle: mocks.localStart,
        startCloudBattle: mocks.applyStart, applyResolvedCloudBattle: mocks.applyResolve });
    return { useGameStore: Object.assign((select: (state: ReturnType<typeof getState>) => unknown) => select(getState()), { getState }) };
});
vi.mock('../../apps/mobile/src/stores/useMobileGameStore', () => {
    const getState = () => ({ activeBattle: mocks.mobileBattle, startBattle: mocks.localStart,
        startCloudBattle: mocks.applyStart, applyResolvedCloudBattle: mocks.applyResolve });
    return { useMobileGameStore: Object.assign((select: (state: ReturnType<typeof getState>) => unknown) => select(getState()), { getState }) };
});
import { useCloudBattleStart as webStart } from './useCloudBattleStart';
import { useCloudBattleResolve as webResolve } from './useCloudBattleResolve';
import { useCloudBattleStart as mobileStart } from '../../apps/mobile/src/hooks/useCloudBattleStart';
import { useCloudBattleResolve as mobileResolve } from '../../apps/mobile/src/hooks/useCloudBattleResolve';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
const attempt = { battleAttemptId: 'started', actors: {
    player: { attack: 10, defense: 5, maxHp: 50 }, enemy: { stage: 1, name: 'enemy', maxHp: 10, attack: 1, defense: 1, xpReward: 5 },
    playerLevel: 1, playerName: 'hero',
} };
let root: Root;
let container: HTMLDivElement;
let mounted: boolean;
function setBattle(id: string | null, status = 'victory', actions: BattleAction[] = [{ type: 'attack' }]) {
    mocks.webBattle = { status, rewardMode: 'cloud', battleAttemptId: id, currentStage: 1, actions };
    mocks.mobileBattle = { stage: 1, rewardMode: 'cloud', battleAttemptId: id,
        state: { outcome: status === 'fighting' ? 'ongoing' : status }, actions };
}
function clearBattle() {
    mocks.webBattle = { status: 'idle', rewardMode: 'local', battleAttemptId: null, currentStage: 1, actions: [] };
    mocks.mobileBattle = null;
}
beforeEach(async () => {
    resetAuthLifecycleHooks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    for (const value of Object.values(mocks)) if (typeof value === 'function') vi.mocked(value).mockReset();
    mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'a' });
    mocks.start.mockResolvedValue(attempt); mocks.localStart.mockReturnValue(true);
    mocks.resolve.mockResolvedValue({ outcome: 'victory', granted: true });
    mocks.applyResolve.mockImplementation(() => {
        mocks.webBattle = { ...mocks.webBattle, battleAttemptId: null };
        if (mocks.mobileBattle) mocks.mobileBattle = { ...mocks.mobileBattle, battleAttemptId: null };
    });
    clearBattle(); await notifyLogin('a');
    container = document.createElement('div'); document.body.append(container); root = createRoot(container); mounted = true;
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); container.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals(); });

describe.each([
    { name: 'Web', useStart: webStart, useResolve: webResolve },
    { name: 'Mobile', useStart: mobileStart, useResolve: mobileResolve },
])('$nameのバトル開始・決着', ({ useStart, useResolve }) => {
    let start: ReturnType<typeof useStart>;
    let resolve: ReturnType<typeof useResolve>;
    function Harness() { start = useStart(); resolve = useResolve(); return null; }
    async function render(strict = false) { await act(async () => root.render(strict ? createElement(StrictMode, null, createElement(Harness)) : createElement(Harness))); }

    it('開始の同一tick連打を一度の送信・適用にまとめる', async () => {
        await render();
        await act(async () => { await Promise.all([start.startStage(1), start.startStage(1)]); });
        expect(mocks.start).toHaveBeenCalledTimes(1); expect(mocks.applyStart).toHaveBeenCalledTimes(1);
        expect(mocks.start.mock.calls[0][3].expectedUserId).toBe('a');
    });
    it('認証確認待ちのログアウト後にローカル開始や旧エラーを反映しない', async () => {
        const auth = deferred<unknown>(); mocks.auth.mockReturnValueOnce(auth.promise); await render();
        let pending!: Promise<unknown>;
        await act(async () => { pending = start.startStage(1); await notifyLogout(); });
        await act(async () => { auth.resolve({ kind: 'anonymous' }); await pending; });
        expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.localStart).not.toHaveBeenCalled();
        expect(start.isStarting).toBe(false); expect(start.startError).toBeNull();
        expect(await start.retry()).toBeNull();
    });
    it('旧Aの開始応答・finallyはBの開始処理を変更しない', async () => {
        const old = deferred<unknown>(); const current = deferred<unknown>();
        mocks.start.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise); await render();
        let a!: Promise<unknown>; let b!: Promise<unknown>;
        const oldCallback = vi.fn();
        await act(async () => { a = start.startStage(1, oldCallback); });
        await act(async () => { mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b'); });
        await act(async () => { b = start.startStage(1); });
        await act(async () => { old.resolve(attempt); await a; });
        expect(mocks.applyStart).not.toHaveBeenCalled(); expect(oldCallback).not.toHaveBeenCalled();
        expect(start.isStarting).toBe(true); expect(start.startError).toBeNull();
        await act(async () => { current.resolve(attempt); await b; });
        expect(mocks.applyStart).toHaveBeenCalledTimes(1); expect(start.isStarting).toBe(false);
    });
    it('開始失敗後は同一ユーザー通知を挟んでも同じ開始IDで再試行する', async () => {
        mocks.start.mockRejectedValueOnce(new TypeError('response lost')); await render();
        await act(async () => { await start.startStage(2); });
        expect(start.startError).not.toBeNull();
        await act(async () => { await notifyLogin('a'); await start.retry(); });
        expect(mocks.start.mock.calls[0].slice(0, 3)).toEqual(mocks.start.mock.calls[1].slice(0, 3));
        expect(mocks.applyStart).toHaveBeenCalledTimes(1);
    });
    it('同じ進行のpull相当のオブジェクト再生成で開始を拒否しない', async () => {
        const response = deferred<unknown>(); mocks.start.mockReturnValueOnce(response.promise); await render();
        let pending!: Promise<unknown>;
        await act(async () => { pending = start.startStage(1); });
        mocks.webBattle = { ...mocks.webBattle };
        await act(async () => { response.resolve(attempt); await pending; });
        expect(mocks.applyStart).toHaveBeenCalledTimes(1);
    });
    it('開始待ちに別戦闘へ移ったら旧応答や事前遷移を適用しない', async () => {
        const old = deferred<unknown>(); mocks.start.mockReturnValueOnce(old.promise); await render();
        let pending!: Promise<unknown>; const before = vi.fn();
        await act(async () => { pending = start.startStage(1, before); });
        setBattle('different', 'fighting'); await render();
        await act(async () => { old.resolve(attempt); await pending; });
        expect(mocks.applyStart).not.toHaveBeenCalled(); expect(before).not.toHaveBeenCalled();
    });
    it('開始失敗後に別戦闘へ移った場合、古い開始対象と事前遷移を再試行しない', async () => {
        mocks.start.mockRejectedValueOnce(new Error('network error')); await render();
        const before = vi.fn();
        await act(async () => { await start.startStage(2, before); });
        setBattle('different', 'fighting'); await render();
        await act(async () => { expect(await start.retry()).toBeNull(); });
        expect(mocks.start).toHaveBeenCalledTimes(1); expect(before).not.toHaveBeenCalled();
    });
    it('SDK主体の切替が通知より先でも別所有者として開始しない', async () => {
        mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await render();
        await act(async () => { await start.startStage(1); });
        expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.localStart).not.toHaveBeenCalled();
    });
    it('匿名バトルは維持し、認証判定不能ではローカル開始しない', async () => {
        await notifyLogout(); mocks.auth.mockResolvedValue({ kind: 'anonymous' }); await render();
        await act(async () => { await start.startStage(1); });
        expect(mocks.localStart).toHaveBeenCalledTimes(1); expect(mocks.start).not.toHaveBeenCalled();
        mocks.auth.mockResolvedValue({ kind: 'unavailable' });
        await act(async () => { await start.startStage(1); });
        expect(mocks.localStart).toHaveBeenCalledTimes(1);
    });
    it('開始待ちのアンマウント後は適用・画面遷移を行わない', async () => {
        const old = deferred<unknown>(); mocks.start.mockReturnValueOnce(old.promise); await render();
        let pending!: Promise<unknown>; const before = vi.fn();
        await act(async () => { pending = start.startStage(1, before); });
        await act(async () => root.unmount()); mounted = false;
        await act(async () => { old.resolve(attempt); await pending; });
        expect(mocks.applyStart).not.toHaveBeenCalled(); expect(before).not.toHaveBeenCalled();
    });
    it('決着適用でattemptIdが消えてもdone/grantedを表示し二重送信しない', async () => {
        setBattle('attempt'); await render();
        expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(mocks.applyResolve).toHaveBeenCalledTimes(1);
        expect(resolve.resolveState).toBe('done'); expect(resolve.granted).toBe(true);
        await render(); await act(async () => resolve.retry());
        expect(mocks.resolve).toHaveBeenCalledTimes(1);
    });
    it('起動時の認証復元前に戦闘が読まれても、最初のログイン後に決着を再開する', async () => {
        resetAuthLifecycleHooks(); setBattle('restored'); await render();
        expect(mocks.resolve).not.toHaveBeenCalled();
        await act(async () => { await notifyLogin('a'); });
        expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(mocks.applyResolve).toHaveBeenCalledTimes(1);
        expect(resolve.resolveState).toBe('done');
    });
    it('決着再試行は連打を防ぎ、行動列と操作IDのコピーを維持する', async () => {
        mocks.resolve.mockRejectedValueOnce(new TypeError('response lost'));
        const actions: BattleAction[] = [{ type: 'skill', skillId: 'original' }]; setBattle('attempt', 'victory', actions); await render();
        expect(resolve.resolveState).toBe('error');
        Object.assign(actions[0], { skillId: 'different' }); actions.push({ type: 'attack' });
        await act(async () => { await notifyLogin('a'); resolve.retry(); resolve.retry(); });
        expect(mocks.resolve).toHaveBeenCalledTimes(2);
        expect(mocks.resolve.mock.calls.map(([id, snapshot]) => [id, snapshot])).toEqual([
            ['attempt', [{ type: 'skill', skillId: 'original' }]], ['attempt', [{ type: 'skill', skillId: 'original' }]],
        ]);
        expect(mocks.resolve.mock.calls[0][2].idempotencyKey).toBe(mocks.resolve.mock.calls[1][2].idempotencyKey);
        expect(resolve.resolveState).toBe('done'); expect(mocks.applyResolve).toHaveBeenCalledTimes(1);
    });
    it('別戦闘の決着中に旧応答を適用せず、旧finallyで新ゲートも解除しない', async () => {
        const old = deferred<unknown>(); const current = deferred<unknown>();
        mocks.resolve.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        setBattle('old'); await render(); setBattle('current'); await render();
        await act(async () => old.resolve({ outcome: 'victory', granted: true }));
        expect(mocks.applyResolve).not.toHaveBeenCalled(); expect(resolve.resolveState).toBe('syncing');
        await act(async () => resolve.retry()); expect(mocks.resolve).toHaveBeenCalledTimes(2);
        await act(async () => current.resolve({ outcome: 'victory', granted: false }));
        expect(mocks.applyResolve).toHaveBeenCalledExactlyOnceWith('current', 'victory', false);
        expect(resolve.granted).toBe(false);
    });
    it('戦闘を閉じた後の旧エラーは表示せず再試行もしない', async () => {
        const old = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(old.promise);
        setBattle('attempt'); await render(); clearBattle(); await render();
        await act(async () => old.reject(new Error('old error')));
        expect(resolve.resolveState).toBe('idle'); expect(resolve.granted).toBeNull();
        await act(async () => resolve.retry()); expect(mocks.resolve).toHaveBeenCalledTimes(1);
    });
    it('決着待ちのA→logout→Aでも旧結果を復活させない', async () => {
        const old = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(old.promise);
        setBattle('attempt'); await render();
        await act(async () => { await notifyLogout(); await notifyLogin('a'); });
        await act(async () => old.resolve({ outcome: 'victory', granted: true }));
        expect(mocks.applyResolve).not.toHaveBeenCalled(); expect(resolve.resolveState).toBe('idle');
        await act(async () => resolve.retry()); expect(mocks.resolve).toHaveBeenCalledTimes(1);
    });
    it('Bの戦闘へ切り替えた後は旧Aの結果や受領表示を混入させない', async () => {
        const old = deferred<unknown>(); const current = deferred<unknown>();
        mocks.resolve.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        setBattle('a-attempt'); await render();
        await act(async () => { mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b'); });
        setBattle('b-attempt'); await render();
        await act(async () => old.resolve({ outcome: 'victory', granted: true }));
        expect(mocks.applyResolve).not.toHaveBeenCalled(); expect(resolve.granted).toBeNull();
        expect(mocks.resolve.mock.calls[1][2].expectedUserId).toBe('b');
        await act(async () => current.resolve({ outcome: 'defeat', granted: false }));
        expect(mocks.applyResolve).toHaveBeenCalledExactlyOnceWith('b-attempt', 'defeat', false);
    });
    it('決着待ちのアンマウント後はストアへ適用しない', async () => {
        const old = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(old.promise); setBattle('attempt'); await render();
        await act(async () => root.unmount()); mounted = false;
        await act(async () => old.resolve({ outcome: 'victory', granted: true }));
        expect(mocks.applyResolve).not.toHaveBeenCalled();
    });
    it('StrictModeの再セットアップでも停止したままにならず一度だけ決着を送る', async () => {
        setBattle('attempt'); await render(true);
        expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(mocks.applyResolve).toHaveBeenCalledTimes(1);
        expect(resolve.resolveState).toBe('done');
    });
});
