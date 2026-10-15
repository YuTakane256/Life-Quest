import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import type { MobileImportResult, PendingMobileContent } from '../platform/cloudMigration';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';

const mocks = vi.hoisted(() => ({ user: vi.fn(), pending: vi.fn(), approve: vi.fn() }));
vi.mock('../platform/auth', () => ({ getCurrentUser: mocks.user }));
vi.mock('../platform/cloudMigration', () => ({ getPendingMobileContent: mocks.pending, approveMobileContentImport: mocks.approve }));
import { useMobileAccountImport } from './useMobileAccountImport';

let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useMobileAccountImport>;
function Harness() { latest = useMobileAccountImport(); return null; }
function content(id = 'local'): PendingMobileContent {
    return { tasks: [{ id, name: id, dueDate: null, priority: 'medium', tags: [], subtasks: [], recurrence: 'none',
        completed: false, completedAt: null, createdAt: '2026-10-15T00:00:00Z' }], habits: [], dailyRecords: [] };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
async function mount() { await act(async () => root.render(createElement(Harness))); }
beforeEach(async () => {
    resetAuthLifecycleHooks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.user.mockReset().mockResolvedValue({ userId: 'a', email: 'a@example.invalid' });
    mocks.pending.mockReset().mockResolvedValue(content());
    mocks.approve.mockReset().mockResolvedValue({ status: 'imported' });
    await notifyLogin('a');
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals(); });

describe('Mobile設定画面のアカウント・統合状態', () => {
    it('上限超過の明示エラーを一般的な通信エラーへ隠さず、候補を送信しない', async () => {
        mocks.pending.mockRejectedValueOnce(new EdgeFunctionError('import-limit-exceeded', '取り込み上限を超えています。データは保持しています。'));
        await mount();
        expect(latest.importMessage).toContain('取り込み上限');
        expect(latest.pendingContent).toBeNull();
        expect(mocks.approve).not.toHaveBeenCalled();
    });

    it('ログイン初期化中のmountはバックアップ作成完了まで候補取得を待機する', async () => {
        const gate = deferred<void>();
        registerAuthLifecycleHooks({ onLogin: () => gate.promise });
        const loggingIn = notifyLogin('a');
        mocks.pending.mockResolvedValue({ tasks: [], habits: [], dailyRecords: [] });
        await mount();
        expect(mocks.pending).not.toHaveBeenCalled();
        expect(latest.checking).toBe(true);
        mocks.pending.mockResolvedValue(content('backed-up-after-hydration'));
        await act(async () => { gate.resolve(); await loggingIn; });
        expect(latest.pendingContent?.tasks[0].id).toBe('backed-up-after-hydration');
        expect(latest.checking).toBe(false);
    });

    it('同一ユーザー再通知で失敗後の承認候補と再送単位を作り直さない', async () => {
        await mount();
        const original = latest.pendingContent;
        mocks.approve.mockResolvedValueOnce({ status: 'error', message: 'response lost' });
        await act(async () => { await latest.importContent(); await notifyLogin('a'); });
        expect(latest.pendingContent).toBe(original);
        expect(latest.importMessage).toBe('response lost');
        expect(mocks.pending).toHaveBeenCalledTimes(1);
        await act(async () => { await latest.importContent(); });
        expect(mocks.approve.mock.calls.map(([candidate]) => candidate)).toEqual([original, original]);
    });

    it('取得を重ねても遅い旧結果で新しい候補を上書きしない', async () => {
        const old = deferred<PendingMobileContent>();
        mocks.pending.mockReturnValueOnce(old.promise).mockResolvedValue(content('new'));
        await mount();
        await act(async () => { await latest.refreshAccount(); });
        expect(latest.pendingContent?.tasks[0].id).toBe('new');
        await act(async () => old.resolve(content('old')));
        expect(latest.pendingContent?.tasks[0].id).toBe('new');
    });

    it('候補取得中のログアウト後にメール・候補・エラーを再表示しない', async () => {
        const old = deferred<PendingMobileContent>();
        mocks.pending.mockReturnValueOnce(old.promise);
        await mount();
        await act(async () => { await notifyLogout(); });
        expect(latest.currentUser).toBeNull();
        await act(async () => old.reject(new Error('old read failed')));
        expect(latest.pendingContent).toBeNull();
        expect(latest.importMessage).toBeNull();
        expect(latest.checking).toBe(false);
    });

    it('後続の認証フックが待機中でもアカウント切替開始時に旧表示を消す', async () => {
        const gate = deferred<void>();
        registerAuthLifecycleHooks({ onLogin: (id) => id === 'b' ? gate.promise : undefined });
        await mount();
        expect(latest.currentUser?.userId).toBe('a');
        let switching!: Promise<void>;
        await act(async () => { switching = notifyLogin('b'); });
        expect(latest.currentUser).toBeNull();
        expect(latest.pendingContent).toBeNull();
        mocks.user.mockResolvedValue({ userId: 'b', email: 'b@example.invalid' });
        mocks.pending.mockResolvedValue(content('b-data'));
        await act(async () => { gate.resolve(); await switching; });
        expect(latest.currentUser?.userId).toBe('b');
        expect(latest.pendingContent?.tasks[0].id).toBe('b-data');
    });

    it('二重タップを止め、成功後も候補とは別に完了メッセージを残す', async () => {
        await mount();
        const result = deferred<MobileImportResult>();
        mocks.approve.mockReturnValueOnce(result.promise);
        let first!: Promise<boolean>;
        await act(async () => {
            first = latest.importContent();
            expect(await latest.importContent()).toBe(false);
        });
        expect(mocks.approve).toHaveBeenCalledTimes(1);
        expect(latest.importing).toBe(true);
        await act(async () => { result.resolve({ status: 'imported' }); expect(await first).toBe(true); });
        expect(latest.pendingContent).toBeNull();
        expect(latest.importMessage).toContain('統合しました');
        expect(latest.importing).toBe(false);
    });

    it('切替前の送信結果・finallyで新ユーザーの送信状態を上書きしない', async () => {
        await mount();
        const a = deferred<MobileImportResult>();
        const b = deferred<MobileImportResult>();
        mocks.approve.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
        let importingA!: Promise<boolean>;
        await act(async () => { importingA = latest.importContent(); });
        mocks.user.mockResolvedValue({ userId: 'b', email: null });
        mocks.pending.mockResolvedValue(content('b-data'));
        await act(async () => { await notifyLogin('b'); });
        let importingB!: Promise<boolean>;
        await act(async () => { importingB = latest.importContent(); });
        await act(async () => { a.resolve({ status: 'imported' }); expect(await importingA).toBe(false); });
        expect(latest.importing).toBe(true);
        expect(latest.pendingContent?.tasks[0].id).toBe('b-data');
        expect(latest.importMessage).toBeNull();
        await act(async () => { b.resolve({ status: 'imported' }); await importingB; });
        expect(latest.importing).toBe(false);
    });

    it.each(['error', 'web_migration_required'] as const)('失敗%sは候補を保持して再試行できる', async (status) => {
        await mount();
        const original = latest.pendingContent;
        mocks.approve.mockResolvedValueOnce({ status, message: 'offline' });
        await act(async () => { await latest.importContent(); });
        expect(latest.pendingContent).toBe(original);
        expect(latest.importMessage).toBeTruthy();
        await act(async () => { expect(await latest.importContent()).toBe(true); });
    });

    it('確認失敗を表示して再確認できる', async () => {
        mocks.pending.mockRejectedValueOnce(new Error('storage unavailable'));
        await mount();
        expect(latest.currentUser?.userId).toBe('a');
        expect(latest.importMessage).toContain('再確認');
        await act(async () => { await latest.refreshAccount(); });
        expect(latest.pendingContent?.tasks[0].id).toBe('local');
        expect(latest.importMessage).toBeNull();
    });

    it('表示を後回しにしても送信せず、再確認で候補を再取得できる', async () => {
        await mount();
        await act(async () => latest.dismissPendingContent());
        expect(latest.pendingContent).toBeNull();
        expect(mocks.approve).not.toHaveBeenCalled();
        await act(async () => { await latest.refreshAccount(); });
        expect(latest.pendingContent).not.toBeNull();
    });

    it('画面離脱後の遅い承認結果を反映しない', async () => {
        await mount();
        const result = deferred<MobileImportResult>();
        mocks.approve.mockReturnValueOnce(result.promise);
        let importing!: Promise<boolean>;
        await act(async () => { importing = latest.importContent(); root.render(null); });
        result.resolve({ status: 'imported' });
        expect(await importing).toBe(false);
    });
});
