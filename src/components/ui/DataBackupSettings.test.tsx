import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { exportAllData, MAX_IMPORT_FILE_SIZE } from '../../utils/dataBackup';
import { DataBackupSettings } from './DataBackupSettings';

const mocks = vi.hoisted(() => ({ settle: vi.fn(), reload: vi.fn() }));
vi.mock('../../platform/completionRewards', () => ({ withSettledGamePersistence: mocks.settle }));
vi.mock('../../platform/backupBrowser', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../platform/backupBrowser')>(),
    reloadAfterBackupImport: mocks.reload,
}));

let root: Root | null;
let host: HTMLDivElement;
let click: ReturnType<typeof vi.spyOn>;
let createUrl: ReturnType<typeof vi.fn<(blob: Blob | MediaSource) => string>>;
let revokeUrl: ReturnType<typeof vi.fn<(url: string) => void>>;
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
function button(label: string) {
    const found = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
}
function file(text: string | Promise<string>, name = 'backup.json', type = 'application/json', size = 100): File {
    return { name, type, size, text: () => Promise.resolve(text) } as File;
}
function json(label: string) {
    localStorage.setItem('quest-board-tasks', JSON.stringify({ state: { tasks: [{
        id: label, name: label, dueDate: null, priority: 'medium', tags: [], subtasks: [],
        recurrence: 'none', completed: false, completedAt: null, createdAt: '2026-10-18T00:00:00Z',
    }] } }));
    const result = JSON.stringify(exportAllData());
    localStorage.removeItem('quest-board-tasks');
    return result;
}
async function select(candidate: File) {
    const input = host.querySelector('input')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [candidate] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
}
function holdPersistence() {
    const gate = deferred<void>();
    // Execute real export/import only after the simulated persistence/lock wait.
    mocks.settle.mockImplementationOnce(async (work: () => unknown) => { await gate.promise; return work(); });
    return gate;
}
function unmount() { act(() => { root!.unmount(); root = null; }); }

beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a');
    vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.settle.mockReset().mockImplementation(async (work: () => unknown) => work());
    mocks.reload.mockReset();
    createUrl = vi.fn<(blob: Blob | MediaSource) => string>(() => 'blob:backup'); revokeUrl = vi.fn<(url: string) => void>();
    vi.stubGlobal('URL', class extends URL {
        static createObjectURL = createUrl;
        static revokeObjectURL = revokeUrl;
    });
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    act(() => root!.render(<StrictMode><DataBackupSettings /></StrictMode>));
});
afterEach(() => {
    if (root) unmount();
    host.remove(); localStorage.clear(); resetAuthLifecycleHooks();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('Webバックアップの実描画・操作と認証境界', () => {
    it('通常の保存は現在のデータと日付付きJSONをダウンロードし、URLを解放する', async () => {
        localStorage.setItem('quest-board-tasks', '{"state":{"tasks":[{"id":"current"}]}}');
        await act(async () => button('保存').click());
        expect(click).toHaveBeenCalledTimes(1);
        const link = click.mock.instances[0] as HTMLAnchorElement;
        expect(link.download).toMatch(/^life-quest-backup-\d{4}-\d{2}-\d{2}\.json$/);
        expect(link.href).toBe('blob:backup');
        expect(createUrl.mock.calls[0][0]).toBeInstanceOf(Blob);
        expect(revokeUrl).toHaveBeenCalledWith('blob:backup');
        expect(button('保存').disabled).toBe(false);
    });

    it('保存の連打は同じ待機中に1回だけ実行する', async () => {
        const gate = holdPersistence(); const save = button('保存');
        await act(async () => { save.click(); save.click(); });
        expect(mocks.settle).toHaveBeenCalledTimes(1);
        expect(button('保存中…').disabled).toBe(true); expect(button('復元').disabled).toBe(true);
        await act(async () => gate.resolve()); expect(click).toHaveBeenCalledTimes(1);
    });

    it.each(['switch', 'logout-login', 'unmount'] as const)('保存待ちの%s後はストレージを読まず、ダウンロードしない', async (transition) => {
        const gate = holdPersistence(); await act(async () => button('保存').click());
        if (transition === 'unmount') unmount();
        else await act(async () => {
            if (transition === 'logout-login') { await notifyLogout(); await notifyLogin('a'); }
            else await notifyLogin('b');
        });
        const read = vi.spyOn(Storage.prototype, 'getItem');
        await act(async () => gate.resolve());
        expect(read).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
    });

    it('同一ユーザーの重複認証通知では保存を中断しない', async () => {
        const gate = holdPersistence(); await act(async () => button('保存').click());
        await act(async () => { await notifyLogin('a'); gate.resolve(); });
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('同一ユーザー通知でも復元候補を維持し、同じファイルを再選択できる', async () => {
        const candidate = file(json('same-user')); await select(candidate);
        await act(async () => notifyLogin('a'));
        expect(host.querySelector('[role="dialog"]')).not.toBeNull();
        act(() => button('キャンセル').click()); await select(candidate);
        await act(async () => button('上書きする').click());
        expect(localStorage.getItem('quest-board-tasks')).toContain('same-user');
    });

    it('ダウンロード失敗でもURLを解放し、エラー表示後に再試行できる', async () => {
        click.mockImplementationOnce(() => { throw new Error('download failed'); });
        await act(async () => button('保存').click());
        expect(revokeUrl).toHaveBeenCalledWith('blob:backup'); expect(host.querySelector('[role="alert"]')).not.toBeNull();
        await act(async () => button('保存').click());
        expect(click).toHaveBeenCalledTimes(2); expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it('新しいファイル選択が古い読み込みを置き換え、実際に新しいデータだけ復元する', async () => {
        const old = deferred<string>(); const oldJson = json('old'); const latestJson = json('latest');
        await select(file(old.promise)); await select(file(latestJson));
        await act(async () => old.resolve(oldJson));
        await act(async () => button('上書きする').click());
        expect(localStorage.getItem('quest-board-tasks')).toContain('latest');
        expect(localStorage.getItem('quest-board-tasks')).not.toContain('old');
        expect(host.querySelector('[role="status"]')?.textContent).toContain('復元しました');
        expect(button('復元中…').disabled).toBe(true);
        expect(mocks.reload).toHaveBeenCalledTimes(1);
        await act(async () => vi.advanceTimersByTimeAsync(1500)); expect(mocks.reload).toHaveBeenCalledTimes(1);
    });

    it('古いファイルの読み込み失敗で新しい確認画面を閉じない', async () => {
        const old = deferred<string>(); await select(file(old.promise)); await select(file(json('latest')));
        await act(async () => old.reject(new Error('read failed')));
        expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it.each(['switch', 'unmount'] as const)('ファイル読込中の%s後に古い確認画面やエラーを表示しない', async (transition) => {
        const old = deferred<string>(); const text = json('old'); await select(file(old.promise));
        if (transition === 'unmount') unmount(); else await act(async () => notifyLogin('b'));
        await act(async () => old.resolve(text));
        expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it.each([
        ['too-large.json', 'application/json', MAX_IMPORT_FILE_SIZE + 1],
        ['backup.txt', 'application/json', 100],
        ['backup.json', 'image/png', 100],
        ['backup.json', 'application/json', 100],
    ])('不正なファイルを拒否する (%s / %s / %s)', async (name, type, size) => {
        const candidate = file('not-json', name, type, size); const read = vi.spyOn(candidate, 'text');
        await select(candidate);
        expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector('[role="dialog"]')).toBeNull();
        if (size > MAX_IMPORT_FILE_SIZE || name.endsWith('.txt') || type === 'image/png') expect(read).not.toHaveBeenCalled();
        expect(mocks.settle).not.toHaveBeenCalled();
    });

    it('確認取消ではストレージを変更しない', async () => {
        await select(file(json('imported'))); localStorage.setItem('quest-board-tasks', 'original');
        act(() => button('キャンセル').click());
        expect(localStorage.getItem('quest-board-tasks')).toBe('original'); expect(mocks.settle).not.toHaveBeenCalled();
        expect(host.querySelector('[role="dialog"]')).toBeNull();
    });

    it('承認前の認証切替は復元候補を破棄する', async () => {
        await select(file(json('old-account'))); const oldConfirm = button('上書きする');
        await act(async () => notifyLogin('b'));
        expect(host.querySelector('[role="dialog"]')).toBeNull();
        act(() => oldConfirm.click()); expect(mocks.settle).not.toHaveBeenCalled();
        expect(button('復元').disabled).toBe(false);
    });

    it('復元の連打は1回だけ処理し、再読み込み前の別操作も防ぐ', async () => {
        await select(file(json('imported'))); const gate = holdPersistence(); const confirm = button('上書きする');
        await act(async () => { confirm.click(); confirm.click(); });
        expect(mocks.settle).toHaveBeenCalledTimes(1); expect(confirm.disabled).toBe(true);
        await act(async () => gate.resolve());
        act(() => button('保存').click()); expect(mocks.settle).toHaveBeenCalledTimes(1);
        expect(mocks.reload).toHaveBeenCalledTimes(1);
        await act(async () => vi.advanceTimersByTimeAsync(1500)); expect(mocks.reload).toHaveBeenCalledTimes(1);
    });

    it.each(['cancel', 'switch', 'logout-login', 'unmount'] as const)('復元待ちの%s後は書き込み・成功表示・再読み込みを行わない', async (transition) => {
        await select(file(json('imported'))); localStorage.setItem('quest-board-tasks', 'original');
        const gate = holdPersistence(); await act(async () => button('上書きする').click());
        if (transition === 'cancel') act(() => button('キャンセル').click());
        else if (transition === 'unmount') unmount();
        else await act(async () => {
            if (transition === 'logout-login') { await notifyLogout(); await notifyLogin('a'); }
            else await notifyLogin('b');
        });
        await act(async () => { gate.resolve(); await vi.advanceTimersByTimeAsync(3000); });
        expect(localStorage.getItem('quest-board-tasks')).toBe('original');
        expect(host.querySelector('[role="status"]')).toBeNull(); expect(mocks.reload).not.toHaveBeenCalled();
    });

    it('Aの旧復元完了でBの保存中表示を解除しない', async () => {
        await select(file(json('a'))); const old = holdPersistence(); await act(async () => button('上書きする').click());
        await act(async () => notifyLogin('b'));
        const latest = holdPersistence(); await act(async () => button('保存').click());
        await act(async () => old.resolve());
        expect(button('保存中…').disabled).toBe(true); expect(click).not.toHaveBeenCalled();
        await act(async () => latest.resolve()); expect(click).toHaveBeenCalledTimes(1);
    });

    it.each(['switch', 'unmount'] as const)('復元コミット時点で再読み込みを開始し、待機終了前の%sでも失われない', async (transition) => {
        await select(file(json('imported')));
        const completion = deferred<void>();
        mocks.settle.mockImplementationOnce(async (work: () => unknown) => {
            const result = work();
            // Simulate the lock request promise settling later than its storage callback.
            await completion.promise;
            return result;
        });
        await act(async () => button('上書きする').click());
        expect(localStorage.getItem('quest-board-tasks')).toContain('imported');
        expect(mocks.reload).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
        if (transition === 'unmount') unmount(); else await act(async () => notifyLogin('b'));
        expect(vi.getTimerCount()).toBe(0);
        await act(async () => { completion.resolve(); await vi.advanceTimersByTimeAsync(3000); });
        expect(mocks.reload).toHaveBeenCalledTimes(1);
    });

    it('エラーの古いタイマーで後から出たエラーを消さない', async () => {
        await select(file('invalid')); await act(async () => vi.advanceTimersByTimeAsync(2000));
        await select(file('also-invalid')); await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        await act(async () => vi.advanceTimersByTimeAsync(2000)); expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it('ストレージ書き込み失敗では既存値を復旧し、復元成功/再読み込みを行わない', async () => {
        const text = json('imported'); localStorage.setItem('quest-board-tasks', 'original'); await select(file(text));
        const originalSet = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); })
            .mockImplementation(function (this: Storage, key, value) { originalSet.call(this, key, value); });
        await act(async () => button('上書きする').click());
        expect(localStorage.getItem('quest-board-tasks')).toBe('original'); expect(host.querySelector('[role="alert"]')).not.toBeNull();
        await act(async () => vi.advanceTimersByTimeAsync(3000)); expect(mocks.reload).not.toHaveBeenCalled();
    });

    it.each(['save', 'restore'] as const)('実際の永続化ヘルパーのWeb Lock待ちでも%sの認証切替を隔離する', async (mode) => {
        const actual = await vi.importActual<typeof import('../../platform/completionRewards')>('../../platform/completionRewards');
        mocks.settle.mockImplementation(actual.withSettledGamePersistence);
        const gate = deferred<void>();
        const request = vi.fn(async (_name: string, work: () => unknown) => { await gate.promise; return work(); });
        vi.stubGlobal('navigator', { locks: { request } });
        if (mode === 'restore') await select(file(json('old-account')));
        localStorage.setItem('quest-board-tasks', 'new-account-data');
        await act(async () => button(mode === 'save' ? '保存' : '上書きする').click());
        expect(request).toHaveBeenCalledTimes(1);
        await act(async () => { await notifyLogin('b'); gate.resolve(); });
        expect(localStorage.getItem('quest-board-tasks')).toBe('new-account-data');
        expect(click).not.toHaveBeenCalled(); expect(mocks.reload).not.toHaveBeenCalled();
    });

    it.each(['save', 'restore'] as const)('新しいアカウントの%sも認証初期化完了まで保存領域に触れない', async (mode) => {
        const gate = deferred<void>();
        registerAuthLifecycleHooks({ onLogin: async () => {
            await gate.promise;
            localStorage.setItem('quest-board-tasks', '{"state":{"tasks":[{"id":"b-data"}]}}');
        } });
        let login!: Promise<void>;
        await act(async () => { login = notifyLogin('b'); });
        if (mode === 'restore') await select(file(json('imported')));
        localStorage.setItem('quest-board-tasks', 'a-data');
        await act(async () => button(mode === 'save' ? '保存' : '上書きする').click());
        expect(mocks.settle).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
        expect(localStorage.getItem('quest-board-tasks')).toBe('a-data');
        await act(async () => { gate.resolve(); await login; });
        expect(mocks.settle).toHaveBeenCalledTimes(1);
        if (mode === 'restore') expect(localStorage.getItem('quest-board-tasks')).toContain('imported');
        else expect(click).toHaveBeenCalledTimes(1);
    });
});
