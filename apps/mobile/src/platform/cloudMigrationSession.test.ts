import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { preMigrationBackupKey } from '@life-quest/core/cloudImport';

const mocks = vi.hoisted(() => ({ values: new Map<string, string>(), getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: mocks.getItem, setItem: mocks.setItem, removeItem: vi.fn(async () => undefined),
} }));

import { ensurePreMigrationBackup, registerMobileCloudMigrationHooks } from './cloudMigration';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileGameStore } from '../stores/useMobileGameStore';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function setLocalData(id: string, xp: number, hasHydrated = true) {
    useMobileTaskStore.setState({ tasks: [{ id, name: id, dueDate: null, priority: 'medium', tags: [], subtasks: [],
        recurrence: 'none', completed: false, completedAt: null, createdAt: '2026-10-15T00:00:00Z' }], hasHydrated });
    useMobileHabitStore.setState({ habits: [], records: [], restDays: [], rewardEligibleDates: [], hasHydrated });
    useMobileGameStore.setState((state) => ({ character: { ...state.character, totalXp: xp }, hasHydrated }));
}
beforeEach(() => {
    resetAuthLifecycleHooks();
    mocks.values.clear();
    mocks.getItem.mockReset().mockImplementation(async (key: string) => mocks.values.get(key) ?? null);
    mocks.setItem.mockReset().mockImplementation(async (key: string, value: string) => { mocks.values.set(key, value); });
    setLocalData('local-a', 75);
});
afterEach(() => { resetAuthLifecycleHooks(); vi.restoreAllMocks(); });

describe('Mobile初回バックアップのセッション境界', () => {
    it('保存領域の読み込み失敗後も同じセッションで再試行できる', async () => {
        await notifyLogin('a');
        mocks.getItem.mockRejectedValueOnce(new Error('storage unavailable'));
        await expect(ensurePreMigrationBackup('a')).rejects.toThrow('storage unavailable');
        await ensurePreMigrationBackup('a');
        expect(mocks.values.has(preMigrationBackupKey('a'))).toBe(true);
    });

    it('開始済み保存は取り消さないが、保存内容は開始前のAのスナップショットである', async () => {
        await notifyLogin('a');
        const saved = deferred<void>();
        mocks.setItem.mockImplementation(async (key: string, value: string) => {
            if (key === preMigrationBackupKey('a')) await saved.promise;
            mocks.values.set(key, value);
        });
        const backup = ensurePreMigrationBackup('a');
        await settle();
        expect(mocks.setItem.mock.calls.filter(([key]) => key === preMigrationBackupKey('a'))).toHaveLength(1);
        await notifyLogin('b');
        setLocalData('b-private', 999);
        saved.resolve();
        await backup;
        const stored = JSON.parse(mocks.values.get(preMigrationBackupKey('a'))!);
        expect(stored.tasks.map((task: { id: string }) => task.id)).toEqual(['local-a']);
        expect(stored.game.character.totalXp).toBe(75);
    });

    for (const transition of ['logout', 'switch', 'return-to-a'] as const) {
        it(`保存済み確認待機中の${transition}後に新セッションのデータを旧キーへ保存しない`, async () => {
            await notifyLogin('a');
            const existing = deferred<string | null>();
            mocks.getItem.mockReturnValueOnce(existing.promise);
            const backup = ensurePreMigrationBackup('a');
            if (transition === 'logout') await notifyLogout();
            else await notifyLogin('b');
            if (transition === 'return-to-a') await notifyLogin('a');
            setLocalData('new-scope', 999);
            existing.resolve(null);
            await backup;
            expect(mocks.values.has(preMigrationBackupKey('a'))).toBe(false);
        });
    }

    it('hydration待機中の切替後にBの復元結果をAのバックアップへ混入させない', async () => {
        await notifyLogin('a');
        setLocalData('not-hydrated', 0, false);
        const backup = ensurePreMigrationBackup('a');
        await settle();
        await notifyLogin('b');
        setLocalData('b-private', 999);
        await backup;
        expect(mocks.values.has(preMigrationBackupKey('a'))).toBe(false);
    });

    it('同一ユーザー通知では待機を共有し、保存完了より先に同期へ進まない', async () => {
        const existing = deferred<string | null>();
        mocks.getItem.mockReturnValueOnce(existing.promise);
        registerMobileCloudMigrationHooks();
        const afterBackup = vi.fn();
        registerAuthLifecycleHooks({ onLogin: afterBackup });
        const first = notifyLogin('a');
        const repeated = notifyLogin('a');
        await settle();
        expect(mocks.getItem).toHaveBeenCalledTimes(1);
        expect(afterBackup).not.toHaveBeenCalled();
        existing.resolve(null);
        await Promise.all([first, repeated]);
        expect(afterBackup).toHaveBeenCalledTimes(1);
        const writes = mocks.setItem.mock.calls.filter(([key]) => key === preMigrationBackupKey('a'));
        expect(writes).toHaveLength(1);
        const saved = JSON.parse(writes[0][1]);
        expect(saved.tasks.map((task: { id: string }) => task.id)).toEqual(['local-a']);
        expect(saved.game.character.totalXp).toBe(75);
        setLocalData('cloud-pulled', 1234);
        await ensurePreMigrationBackup('a');
        expect(mocks.values.get(preMigrationBackupKey('a'))).toBe(writes[0][1]);
    });

    it('失効した旧処理の完了後も新しい同名ユーザーの処理を共有できる', async () => {
        await notifyLogin('a');
        const oldRead = deferred<string | null>();
        const newRead = deferred<string | null>();
        mocks.getItem.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
        const oldBackup = ensurePreMigrationBackup('a');
        await notifyLogout();
        await notifyLogin('a');
        const newBackup = ensurePreMigrationBackup('a');
        oldRead.resolve(null);
        await oldBackup;
        const repeated = ensurePreMigrationBackup('a');
        await settle();
        expect(mocks.getItem).toHaveBeenCalledTimes(2);
        newRead.resolve(null);
        await Promise.all([newBackup, repeated]);
        const writes = mocks.setItem.mock.calls.filter(([key]) => key === preMigrationBackupKey('a'));
        expect(writes).toHaveLength(1);
    });
});
