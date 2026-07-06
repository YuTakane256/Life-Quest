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
        useMobileGameStore.setState((state) => ({ character: { ...state.character, totalXp: 777 } }));

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
        await ensurePreMigrationBackup('user-a');
        expect(memory.has(preMigrationBackupKey('user-a'))).toBe(true);
        expect(memory.has(preMigrationBackupKey('user-b'))).toBe(false);
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
