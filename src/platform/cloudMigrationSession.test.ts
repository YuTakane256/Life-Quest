import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createEdgeFunctionInvoker, type EdgeFunctionInvoker } from '@life-quest/core/edgeFunctions';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), invoke: null as EdgeFunctionInvoker | null }));
vi.mock('./supabase', () => ({ getWebSupabaseClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }),
}) }));
vi.mock('./edgeFunctions', () => ({ getWebEdgeFunctionInvoker: () => mocks.invoke }));

import { maybeRunWebCloudImport, registerWebCloudMigrationHooks, resetWebCloudImportState } from './cloudMigration';
import { useTaskStore } from '../stores/useTaskStore';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
function profile(importedAt: string | null = null) {
    return { data: { imported_at: importedAt }, error: null };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const fetchFn = vi.fn();
const getSession = vi.fn();
const refreshSession = vi.fn();

beforeEach(() => {
    resetAuthLifecycleHooks();
    resetWebCloudImportState();
    mocks.profile.mockReset().mockResolvedValue(profile());
    fetchFn.mockReset().mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    getSession.mockReset().mockResolvedValue({ accessToken: 'token-a' });
    refreshSession.mockReset().mockResolvedValue({ accessToken: 'refreshed-a' });
    mocks.invoke = createEdgeFunctionInvoker({ functionsUrl: 'https://example.invalid/functions/v1', anonKey: 'test-anon',
        getSession, refreshSession, fetchFn });
    useTaskStore.setState({ tasks: [{ id: 'local-a', name: 'A local task', dueDate: null, priority: 'medium',
        tags: [], subtasks: [], recurrence: 'none', completed: false, completedAt: null, createdAt: '2026-10-15T00:00:00Z' }] });
});
afterEach(() => { resetWebCloudImportState(); resetAuthLifecycleHooks(); vi.restoreAllMocks(); });

describe('Web初回移行のセッション境界', () => {
    for (const transition of ['logout', 'switch', 'return-to-a'] as const) {
        it(`profiles待機中の${transition}後に別スコープのストアを取り込まない`, async () => {
            await notifyLogin('a');
            const oldProfile = deferred<ReturnType<typeof profile>>();
            mocks.profile.mockReturnValueOnce(oldProfile.promise).mockResolvedValue(profile('already-imported'));
            const oldImport = maybeRunWebCloudImport('a');
            if (transition === 'logout') await notifyLogout();
            else await notifyLogin('b');
            if (transition === 'return-to-a') await notifyLogin('a');
            useTaskStore.setState({ tasks: [] }); // The new scope must never become A's migration source.
            getSession.mockResolvedValue({ accessToken: 'new-scope-token' });
            if (transition !== 'logout') expect(await maybeRunWebCloudImport(transition === 'switch' ? 'b' : 'a')).toBe(true);
            oldProfile.resolve(profile());
            expect(await oldImport).toBe(false);
            expect(fetchFn).not.toHaveBeenCalled();
        });
    }

    it('同一ユーザーの重複通知でも移行完了まで後続の同期フックを待たせる', async () => {
        const waiting = deferred<ReturnType<typeof profile>>();
        mocks.profile.mockReturnValueOnce(waiting.promise);
        registerWebCloudMigrationHooks();
        const afterMigration = vi.fn();
        registerAuthLifecycleHooks({ onLogin: afterMigration });
        const first = notifyLogin('a');
        const repeated = notifyLogin('a');
        await settle();
        expect(afterMigration).not.toHaveBeenCalled();
        waiting.resolve(profile());
        await Promise.all([first, repeated]);
        expect(mocks.profile).toHaveBeenCalledTimes(1);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(afterMigration).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
        expect(body.snapshot.tasks.map((task: { id: string }) => task.id)).toEqual(['local-a']);
        expect(body.idempotencyKey).toBe('web-import-a');
    });

    it('トークン取得待機中に切り替わったら新しいトークンで旧スナップショットを送信しない', async () => {
        await notifyLogin('a');
        const session = deferred<{ accessToken: string }>();
        getSession.mockReturnValueOnce(session.promise);
        const importing = maybeRunWebCloudImport('a');
        await settle();
        expect(getSession).toHaveBeenCalledOnce();
        await notifyLogin('b');
        session.resolve({ accessToken: 'token-b' });
        expect(await importing).toBe(false);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('401 refresh待機中に切り替わったらBのトークンで再送しない', async () => {
        await notifyLogin('a');
        fetchFn.mockResolvedValueOnce(new Response('', { status: 401 }));
        const refreshed = deferred<{ accessToken: string }>();
        refreshSession.mockReturnValueOnce(refreshed.promise);
        const importing = maybeRunWebCloudImport('a');
        await settle();
        expect(refreshSession).toHaveBeenCalledOnce();
        await notifyLogin('b');
        refreshed.resolve({ accessToken: 'token-b' });
        expect(await importing).toBe(false);
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('旧Aの遅い失敗でBの移行確認済み状態を消さない', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await notifyLogin('a');
        const response = deferred<Response>();
        fetchFn.mockReturnValueOnce(response.promise);
        const oldImport = maybeRunWebCloudImport('a');
        await settle();
        await notifyLogin('b');
        mocks.profile.mockResolvedValue(profile('already-imported'));
        expect(await maybeRunWebCloudImport('b')).toBe(true);
        response.reject(new Error('old network failure'));
        expect(await oldImport).toBe(false);
        await maybeRunWebCloudImport('b');
        expect(mocks.profile).toHaveBeenCalledTimes(2);
    });

    it('プロフィール取得失敗は次の同一ユーザー通知で再試行できる', async () => {
        await notifyLogin('a');
        mocks.profile.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
        expect(await maybeRunWebCloudImport('a')).toBe(false);
        expect(await maybeRunWebCloudImport('a')).toBe(true);
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });
    it('network例外の内容をログへ出さず、初回移行を未完了のまま再試行できる', async () => {
        await notifyLogin('a');
        const failure = Object.assign(new Error('private-network-detail'), { details: 'private-network-detail' });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        fetchFn.mockRejectedValueOnce(failure);
        expect(await maybeRunWebCloudImport('a')).toBe(false);
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0]).not.toContain(failure);
        expect(JSON.stringify(warn.mock.calls)).not.toContain('private-network-detail');
        expect(useTaskStore.getState().tasks.map((task) => task.id)).toEqual(['local-a']);
        expect(await maybeRunWebCloudImport('a')).toBe(true);
        expect(fetchFn.mock.calls[0][1].body).toBe(fetchFn.mock.calls[1][1].body);
    });

});
