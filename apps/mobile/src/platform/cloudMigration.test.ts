/**
 * #506 フローBのテスト:
 * - ゲーム状態がプル置換の前にバックアップされ、二重保存しない
 * - クラウドに無いローカルコンテンツだけが検出される（client_id照合を含む）
 * - 未承認コンテンツはローカル（バックアップ・ストア）に残り続ける
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => { memory.set(key, value); }),
        removeItem: vi.fn(async (key: string) => { memory.delete(key); }),
    },
}));

import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import { preMigrationBackupKey } from '@life-quest/core/cloudImport';
import { detectPendingMobileContent, ensurePreMigrationBackup } from './cloudMigration';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';

function localTask(id: string, name: string) {
    return {
        id, name, dueDate: null, priority: 'medium' as const, tags: [], subtasks: [],
        recurrence: 'none' as const, completed: false, completedAt: null,
        createdAt: '2026-07-01T00:00:00.000Z',
    };
}

describe('ensurePreMigrationBackup', () => {
    beforeEach(() => {
        memory.clear();
    });

    it('初回のみバックアップを保存し、既存バックアップは上書きしない', async () => {
        useMobileTaskStore.setState({ tasks: [localTask('m-1', '端末のタスク')], hasHydrated: true });
        useMobileHabitStore.setState({ hasHydrated: true });
        useMobileGameStore.setState((state) => ({ character: { ...state.character, totalXp: 777 }, hasHydrated: true }));

        await ensurePreMigrationBackup('user-1');
        const first = memory.get(preMigrationBackupKey('user-1'))!;
        const parsed = JSON.parse(first) as { game: { character: { totalXp: number } }; tasks: { id: string }[] };
        expect(parsed.game.character.totalXp).toBe(777);
        expect(parsed.tasks.map((task) => task.id)).toEqual(['m-1']);

        // ストアが変わっても（プル置換後でも）バックアップは初回のまま
        useMobileGameStore.setState((state) => ({ character: { ...state.character, totalXp: 0 } }));
        await ensurePreMigrationBackup('user-1');
        expect(memory.get(preMigrationBackupKey('user-1'))).toBe(first);
    });

    it('user_idごとに独立したバックアップキーを使う', async () => {
        useMobileTaskStore.setState({ hasHydrated: true });
        useMobileHabitStore.setState({ hasHydrated: true });
        useMobileGameStore.setState({ hasHydrated: true });
        await ensurePreMigrationBackup('user-a');
        expect(memory.has(preMigrationBackupKey('user-a'))).toBe(true);
        expect(memory.has(preMigrationBackupKey('user-b'))).toBe(false);
    });

    it('hydration完了前は保存を待機し、空データを確定保存しない（競合の再現）', async () => {
        // hydration前の状態を再現: 空のtasks/habits・初期game状態、hasHydrated=false
        useMobileTaskStore.setState({ tasks: [], hasHydrated: false });
        useMobileHabitStore.setState({ habits: [], records: [], hasHydrated: false });
        useMobileGameStore.setState((state) => ({ character: { ...state.character, totalXp: 0 }, hasHydrated: false }));

        const backupPromise = ensurePreMigrationBackup('user-race');

        // hydration未完了の間はまだ保存されていないこと
        await Promise.resolve();
        await Promise.resolve();
        expect(memory.has(preMigrationBackupKey('user-race'))).toBe(false);

        // 実際のhydration完了を再現: 本来のローカルデータが遅れて到着する
        useMobileTaskStore.setState({
            tasks: [localTask('mobile-real-task', '本来退避すべきタスク')],
            hasHydrated: true,
        });
        useMobileHabitStore.setState({
            habits: [{ id: 'real-habit', name: '本来の習慣', categoryId: 'general', createdAt: '2026-07-01T00:00:00.000Z' }],
            hasHydrated: true,
        });
        useMobileGameStore.setState((state) => ({ character: { ...state.character, totalXp: 999 }, hasHydrated: true }));

        await backupPromise;

        const saved = memory.get(preMigrationBackupKey('user-race'))!;
        const parsed = JSON.parse(saved) as {
            game: { character: { totalXp: number } };
            tasks: { id: string }[];
            habits: { id: string }[];
        };
        // hydration前の空データではなく、hydration後の本来のローカルデータが保存されている
        expect(parsed.tasks.map((task) => task.id)).toEqual(['mobile-real-task']);
        expect(parsed.habits.map((habit) => habit.id)).toEqual(['real-habit']);
        expect(parsed.game.character.totalXp).toBe(999);
    });

    it('hydrationがタイムアウトした場合は保存をスキップし、次回再試行できる状態を保つ', async () => {
        useMobileTaskStore.setState({ tasks: [], hasHydrated: false });
        useMobileHabitStore.setState({ habits: [], records: [], hasHydrated: false });
        useMobileGameStore.setState((state) => ({ hasHydrated: false }));

        await ensurePreMigrationBackup('user-timeout', 20); // 短いタイムアウトで即座にスキップさせる

        // 保存されていない = バックアップキー未作成 = 次回ログインで再試行対象のまま
        expect(memory.has(preMigrationBackupKey('user-timeout'))).toBe(false);

        // hydrationが遅れて完了しても、今回の呼び出し結果には影響しない
        useMobileTaskStore.setState({ hasHydrated: true });
        useMobileHabitStore.setState({ hasHydrated: true });
        useMobileGameStore.setState((state) => ({ hasHydrated: true }));

        // 次回ログイン相当の再試行では正しく保存される
        await ensurePreMigrationBackup('user-timeout');
        expect(memory.has(preMigrationBackupKey('user-timeout'))).toBe(true);
    });
});

describe('detectPendingMobileContent', () => {
    it('クラウドの実IDにもclient_idにも存在しないローカル項目だけを検出する', () => {
        useMobileTaskStore.setState({
            tasks: [
                localTask('uuid-in-cloud', '実IDで一致'),
                localTask('web-legacy-id', 'client_idで一致'),
                localTask('mobile-only', 'この端末だけ'),
            ],
            hasHydrated: true,
        });
        useMobileHabitStore.setState({
            habits: [
                { id: 'habit-cloud', name: '同期済み習慣', categoryId: 'general', createdAt: '2026-07-01T00:00:00.000Z' },
                { id: 'habit-only', name: '端末だけの習慣', categoryId: 'general', createdAt: '2026-07-01T00:00:00.000Z' },
            ],
            records: [
                { habitId: 'habit-only', date: '2026-07-01', completed: true, memo: '' },
                { habitId: 'habit-cloud', date: '2026-07-01', completed: true, memo: '' },
            ],
        });

        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 5, has_more: false,
            tasks: [
                { id: 'uuid-in-cloud', client_id: null, version: 2 },
                { id: 'server-uuid-1', client_id: 'web-legacy-id', version: 2 }, // Web移行でclient_idが付いた行
            ],
            habits: [{ id: 'server-uuid-2', client_id: 'habit-cloud', version: 3 }],
        });

        const pending = detectPendingMobileContent(cache);
        expect(pending.tasks.map((task) => task.id)).toEqual(['mobile-only']);
        expect(pending.habits.map((habit) => habit.id)).toEqual(['habit-only']);
        // 未統合の習慣に紐づくログだけが対象になる
        expect(pending.dailyRecords).toEqual([
            { habitId: 'habit-only', date: '2026-07-01', completed: true, memo: '' },
        ]);
    });
});
