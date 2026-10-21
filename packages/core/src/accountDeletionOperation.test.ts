import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountDeletionOperation, createAccountDeletionConfirmation, runAccountDeletionCleanup, type AccountDeletionResult } from './accountDeletion.ts';
import { captureAuthSessionScope, notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from './authLifecycle.ts';
import { createEdgeFunctionInvoker } from './edgeFunctions.ts';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
beforeEach(async () => { resetAuthLifecycleHooks(); await notifyLogin('a'); });
afterEach(resetAuthLifecycleHooks);
function setup() {
    const deps = { getSessionUserId: vi.fn(async () => 'a' as string | null), invokeDelete: vi.fn(async (_options: unknown) => ({} as { apple_revocation?: unknown })),
        detachRewards: vi.fn(), cleanup: vi.fn(async (_userId: string, _active: () => boolean) => {}), signOut: vi.fn(async () => {}), setAnonymous: vi.fn(),
        subscribeSessionIdentity: vi.fn((_listener: (userId: string | null) => void) => () => {}) };
    return { deps, run: createAccountDeletionOperation(deps), approval: { userId: 'a', isActive: () => true } };
}
describe('confirmed account deletion operation', () => {
    it('通常削除は一度だけ送信し、対象namespaceを片付けてログアウトする', async () => {
        const { deps, run, approval } = setup(); const first = run(approval); expect(run(approval)).toBe(first); const result = await first;
        expect(result.ok).toBe(true); expect(result.completionScope?.()).toBe(true); expect(deps.invokeDelete).toHaveBeenCalledOnce();
        expect(deps.invokeDelete).toHaveBeenCalledWith({ expectedUserId: 'a', isActive: expect.any(Function) });
        expect(deps.cleanup).toHaveBeenCalledWith('a', expect.any(Function)); expect(deps.signOut).toHaveBeenCalledOnce(); expect(deps.setAnonymous).toHaveBeenCalledOnce();
        expect(captureAuthSessionScope().userId).toBeNull();
    });
    it('SDKの先行SIGNED_OUTも正常完了として扱い、成功通知を新ログインには持ち越さない', async () => {
        const { deps, run, approval } = setup(); deps.signOut.mockImplementation(async () => { await notifyLogout(); });
        const result = await run(approval); expect(result.ok).toBe(true); await notifyLogin('b'); expect(result.completionScope?.()).toBe(false);
    });
    it.each(['approval', 'session', 'scope'])('%sが一致しなければRPCを送らない', async (kind) => {
        const { deps, run, approval } = setup(); if (kind === 'approval') approval.isActive = () => false;
        if (kind === 'session') deps.getSessionUserId.mockResolvedValue('b'); if (kind === 'scope') await notifyLogin('b');
        expect((await run(approval)).ok).toBe(false); expect(deps.invokeDelete).not.toHaveBeenCalled(); expect(deps.cleanup).not.toHaveBeenCalled();
    });
    it.each(['switch', 'logout', 'roundtrip', 'view'])('セッション照会中の%sでは送信しない', async (kind) => {
        const { deps, run, approval } = setup(); const wait = deferred<string | null>(); deps.getSessionUserId.mockReturnValueOnce(wait.promise);
        const pending = run(approval); await Promise.resolve();
        if (kind === 'switch') await notifyLogin('b'); if (kind === 'logout') await notifyLogout();
        if (kind === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); } if (kind === 'view') approval.isActive = () => false;
        wait.resolve('a'); expect((await pending).ok).toBe(false); expect(deps.invokeDelete).not.toHaveBeenCalled();
    });
    it('同一ユーザー通知とトークン更新を許容する', async () => {
        const { deps, run, approval } = setup(); const wait = deferred<string | null>(); deps.getSessionUserId.mockReturnValueOnce(wait.promise);
        const pending = run(approval); await Promise.resolve(); await notifyLogin('a'); wait.resolve('a'); expect((await pending).ok).toBe(true);
    });
    it.each(['session', 'rpc', 'cleanup'] as const)('SDKの切替をlifecycleより先に検出する（%s待機）', async (stage) => {
        const { deps, run, approval } = setup(); const wait = deferred<void>();
        if (stage === 'session') deps.getSessionUserId.mockImplementationOnce(async () => { await wait.promise; return 'a'; });
        if (stage === 'rpc') deps.invokeDelete.mockImplementationOnce(async () => { await wait.promise; return {}; });
        if (stage === 'cleanup') deps.cleanup.mockReturnValueOnce(wait.promise);
        const pending = run(approval);
        const called = stage === 'session' ? deps.getSessionUserId : stage === 'rpc' ? deps.invokeDelete : deps.cleanup;
        await vi.waitFor(() => expect(called).toHaveBeenCalledOnce());
        const event = deps.subscribeSessionIdentity.mock.calls[0][0]; event('b'); event('a');
        expect(captureAuthSessionScope().userId).toBe('a'); wait.resolve(); expect((await pending).ok).toBe(false);
        expect(deps.signOut).not.toHaveBeenCalled(); expect(deps.setAnonymous).not.toHaveBeenCalled();
        if (stage !== 'cleanup') expect(deps.cleanup).not.toHaveBeenCalled();
    });
    it.each(['normal', 'returning-account'])('SDKの自分のsignOutと、null後の復帰を区別する（%s）', async (kind) => {
        const { deps, run, approval } = setup(); deps.signOut.mockImplementationOnce(async () => {
            const event = deps.subscribeSessionIdentity.mock.calls[0][0]; event(null); event(null);
            if (kind === 'returning-account') event('a');
        });
        expect((await run(approval)).ok).toBe(kind === 'normal');
        expect(deps.setAnonymous).toHaveBeenCalledTimes(kind === 'normal' ? 1 : 0);
    });
    it('認証初期化を待ってからセッションを照会する', async () => {
        const wait = deferred<void>(); registerAuthLifecycleHooks({ onLogin: () => wait.promise });
        const login = notifyLogin('b'); const { deps, run } = setup(); deps.getSessionUserId.mockResolvedValue('b');
        const pending = run({ userId: 'b', isActive: () => true }); await Promise.resolve(); expect(deps.getSessionUserId).not.toHaveBeenCalled();
        wait.resolve(); await login; expect((await pending).ok).toBe(true);
    });
    it.each(['switch', 'logout', 'roundtrip'])('サーバー応答中の%sで新状態の後始末・ログアウトをしない', async (kind) => {
        const { deps, run, approval } = setup(); const wait = deferred<{ apple_revocation?: unknown }>(); deps.invokeDelete.mockReturnValueOnce(wait.promise);
        const pending = run(approval); await vi.waitFor(() => expect(deps.invokeDelete).toHaveBeenCalledOnce());
        if (kind === 'switch') await notifyLogin('b'); if (kind === 'logout') await notifyLogout();
        if (kind === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); }
        wait.resolve({}); expect((await pending).ok).toBe(false); expect(deps.cleanup).not.toHaveBeenCalled(); expect(deps.signOut).not.toHaveBeenCalled(); expect(deps.detachRewards).not.toHaveBeenCalled();
    });
    it('RPC開始後の画面離脱は同じアカウントの必要な後始末を妨げない', async () => {
        const { deps, run, approval } = setup(); const wait = deferred<{ apple_revocation?: unknown }>(); deps.invokeDelete.mockReturnValueOnce(wait.promise);
        const pending = run(approval); await vi.waitFor(() => expect(deps.invokeDelete).toHaveBeenCalledOnce()); approval.isActive = () => false;
        wait.resolve({}); expect((await pending).ok).toBe(true); expect(deps.cleanup).toHaveBeenCalledOnce();
    });
    it.each(['cleanup', 'signOut'] as const)('%s待機中のA→B→匿名でBを初期化せず、旧完了を採用しない', async (kind) => {
        const { deps, run, approval } = setup(); const wait = deferred<void>(); deps[kind].mockReturnValueOnce(wait.promise);
        const pending = run(approval); await vi.waitFor(() => expect(deps[kind]).toHaveBeenCalledOnce());
        await notifyLogin('b'); await notifyLogout(); wait.resolve(); expect((await pending).ok).toBe(false); expect(deps.setAnonymous).not.toHaveBeenCalled();
        if (kind === 'cleanup') expect(deps.signOut).not.toHaveBeenCalled();
    });
    it.each(['detachRewards', 'cleanup', 'signOut'] as const)('%s失敗でも残工程を試み、削除後の警告を返す', async (kind) => {
        const { deps, run, approval } = setup(); deps[kind].mockImplementationOnce(() => { throw new Error('fixture'); });
        const result = await run(approval); expect(result.ok).toBe(false); expect(result.completionScope?.()).toBe(true);
        expect(deps.cleanup).toHaveBeenCalledOnce(); expect(deps.signOut).toHaveBeenCalledOnce(); expect(deps.setAnonymous).toHaveBeenCalledOnce();
    });
    it('不明な送信結果を自動で再送せず、未削除とも断定しない', async () => {
        const { deps, run, approval } = setup(); deps.invokeDelete.mockRejectedValueOnce(new Error('network'));
        const result = await run(approval); expect(result).toMatchObject({ ok: false, message: expect.stringContaining('退会結果を確認できません') });
        expect(deps.invokeDelete).toHaveBeenCalledOnce(); expect(deps.cleanup).not.toHaveBeenCalled();
        expect((await run(approval)).ok).toBe(true); expect(deps.invokeDelete).toHaveBeenCalledTimes(2);
    });
    it('同じ共有InvokerでもBのJWTへ差し替わったら削除を送らない', async () => {
        const { deps, run, approval } = setup(); const fetchFn = vi.fn<typeof fetch>();
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid/functions/v1', anonKey: 'fixture',
            getSession: async () => ({ userId: 'b', accessToken: 'b-fixture' }), refreshSession: async () => null, fetchFn });
        deps.invokeDelete.mockImplementation((options) => invoke('delete_account', {}, options as Parameters<typeof invoke>[2]));
        expect((await run(approval)).ok).toBe(false); expect(fetchFn).not.toHaveBeenCalled();
    });
    it('Appleの手動失効案内を維持する', async () => {
        const { deps, run, approval } = setup(); deps.invokeDelete.mockResolvedValue({ apple_revocation: 'manual_required' });
        expect(await run(approval)).toMatchObject({ ok: true, manualAppleRevocationRequired: true });
    });
    it('片付け失敗でもAppleの手動失効案内を失わない', async () => {
        const { deps, run, approval } = setup(); deps.invokeDelete.mockResolvedValue({ apple_revocation: 'manual_required' });
        deps.cleanup.mockRejectedValueOnce(new Error('storage fixture'));
        expect(await run(approval)).toMatchObject({ ok: false, message: expect.stringContaining('Appleの「Apple IDを使用中のApp」') });
    });
    it('401後の更新トークンがBなら削除リクエストを再送しない', async () => {
        const { deps, run, approval } = setup(); const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
        const invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid/functions/v1', anonKey: 'fixture', getSession: async () => ({ userId: 'a', accessToken: 'a-fixture' }), refreshSession: async () => ({ userId: 'b', accessToken: 'b-fixture' }), fetchFn });
        deps.invokeDelete.mockImplementation((options) => invoke('delete_account', {}, options as Parameters<typeof invoke>[2]));
        expect((await run(approval)).ok).toBe(false); expect(fetchFn).toHaveBeenCalledOnce(); expect(deps.cleanup).not.toHaveBeenCalled();
        expect(fetchFn.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer a-fixture' });
    });
    it('旧要求のfinallyで新アカウントの要求を二重化しない', async () => {
        const { deps, run, approval } = setup(); const old = deferred<{ apple_revocation?: unknown }>(); const next = deferred<{ apple_revocation?: unknown }>();
        deps.invokeDelete.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise); const first = run(approval); await vi.waitFor(() => expect(deps.invokeDelete).toHaveBeenCalledOnce());
        await notifyLogin('b'); deps.getSessionUserId.mockResolvedValue('b'); const nextApproval = { userId: 'b', isActive: () => true }; const second = run(nextApproval);
        await vi.waitFor(() => expect(deps.invokeDelete).toHaveBeenCalledTimes(2)); old.resolve({}); await first; expect(run(nextApproval)).toBe(second);
        next.resolve({}); expect((await second).ok).toBe(true); expect(deps.invokeDelete).toHaveBeenCalledTimes(2);
    });
});

describe('cleanup step boundary', () => {
    it.each(['sync', 'outbox', 'keys'])('%s待機中の切替後は次の共有状態を触らない', async (stage) => {
        let active = true; const order: string[] = []; const wait = deferred<void>();
        const step = async (name: string) => { order.push(name); if (name === stage) await wait.promise; };
        const pending = runAccountDeletionCleanup({ isCurrent: () => active, stopSync: () => step('sync'), stopOutbox: () => step('outbox'), removeCloudData: () => step('keys'), resetMemory: () => step('memory') });
        await vi.waitFor(() => expect(order).toContain(stage)); active = false; wait.resolve(); await pending;
        expect(order).toEqual(['sync', 'outbox', 'keys'].slice(0, ['sync', 'outbox', 'keys'].indexOf(stage) + 1));
    });
});

describe('confirmation ownership', () => {
    function view() { const send = vi.fn(async (_approval: unknown): Promise<AccountDeletionResult> => ({ ok: false, message: 'retry' })); const controller = createAccountDeletionConfirmation(send); const stop = controller.activate(); controller.open({ userId: 'a', email: 'a@example.invalid' }); const owner = controller.getSnapshot().confirmation!; controller.setText(owner, '削除'); return { controller, send, stop, owner }; }
    it('確認対象を示し、同じ確定の連打は1回だけ送信する', async () => {
        const { controller, send, owner, stop } = view(); const first = controller.submit(owner, '削除'); await controller.submit(owner, '削除'); await first;
        expect(send).toHaveBeenCalledOnce(); expect(controller.getSnapshot()).toMatchObject({ busy: false, message: 'retry' }); stop();
    });
    it.each(['switch', 'logout', 'roundtrip', 'cancel', 'blur', 'text'])('%s後の古い確認は送らない', async (kind) => {
        const { controller, send, owner, stop } = view();
        if (kind === 'switch') await notifyLogin('b'); if (kind === 'logout') await notifyLogout(); if (kind === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); }
        if (kind === 'cancel') { controller.cancel(owner); controller.open({ userId: 'a', email: 'a@example.invalid' }); }
        if (kind === 'blur') { stop(); controller.activate(); controller.open({ userId: 'a', email: 'a@example.invalid' }); }
        if (kind === 'text') controller.setText(owner, '別の入力');
        await controller.submit(owner, '削除'); expect(send).not.toHaveBeenCalled(); stop();
    });
    it('自分の退会によるログアウトでも正常な成功通知を表示する', async () => {
        const controller = createAccountDeletionConfirmation(async () => { await notifyLogout(); return { ok: true, completionScope: captureAuthSessionScope().isCurrent }; });
        const stop = controller.activate(); controller.open({ userId: 'a', email: 'a@example.invalid' }); const owner = controller.getSnapshot().confirmation!;
        controller.setText(owner, '削除'); await controller.submit(owner, '削除'); expect(controller.getSnapshot()).toMatchObject({ busy: false, confirmation: null, message: 'アカウントとクラウドデータを削除しました' }); stop();
    });
    it('古い応答とfinallyはBの新しい確認・要求・メッセージに干渉しない', async () => {
        const { controller, send, owner, stop } = view(); const old = deferred<AccountDeletionResult>(); const current = deferred<AccountDeletionResult>();
        send.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise); const first = controller.submit(owner, '削除'); await notifyLogin('b');
        controller.open({ userId: 'b', email: 'b@example.invalid' }); const next = controller.getSnapshot().confirmation!; controller.setText(next, '削除'); const second = controller.submit(next, '削除');
        old.resolve({ ok: false, message: 'old' }); await first; expect(controller.getSnapshot()).toMatchObject({ busy: true, message: null });
        current.resolve({ ok: false, message: 'current' }); await second; expect(controller.getSnapshot()).toMatchObject({ busy: false, message: 'current' }); stop();
    });
});
