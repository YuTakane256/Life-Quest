import { afterEach, describe, expect, it } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { getActiveWebCloudSync, registerWebCloudSyncHooks } from './cloudSync';

describe('registerWebCloudSyncHooks', () => {
    afterEach(() => {
        resetAuthLifecycleHooks();
    });

    it('Supabase環境が未設定ならログイン通知でも同期を開始せず、例外も投げない', async () => {
        const unregister = registerWebCloudSyncHooks();
        await expect(notifyLogin('user-1')).resolves.toBeUndefined();
        expect(getActiveWebCloudSync()).toBeNull();
        await expect(notifyLogout()).resolves.toBeUndefined();
        unregister();
    });

    it('解除後はログイン通知に反応しない', async () => {
        const unregister = registerWebCloudSyncHooks();
        unregister();
        await notifyLogin('user-1');
        expect(getActiveWebCloudSync()).toBeNull();
    });
});

describe('applyCloudCacheToWebStores（データ消失パターンの回帰テスト）', () => {
    it('初期行だけのクラウド状態では、既存ローカルのタスク・習慣・ゲーム状態を上書きしない', async () => {
        const { applyPullBatchToCache, createEmptyCloudCache } = await import('@life-quest/core/cloudCache');
        const { applyCloudCacheToWebStores } = await import('./cloudSync');
        const { useTaskStore } = await import('../stores/useTaskStore');
        const { useHabitStore } = await import('../stores/useHabitStore');
        const { useGameStore } = await import('../stores/useGameStore');

        // 既存ローカルデータ（#506移行前のユーザーを再現）
        const localTask = {
            id: 'local-1', name: 'ローカルの大事なタスク', dueDate: null, priority: 'high' as const,
            tags: [], subtasks: [], recurrence: 'none' as const, completed: false,
            completedAt: null, createdAt: '2026-07-01T00:00:00Z',
        };
        useTaskStore.setState({ tasks: [localTask] });
        useHabitStore.setState({ habits: [{ id: 'h1', name: 'ローカル習慣', categoryId: 'general', createdAt: '2026-07-01T00:00:00Z' }] });
        useGameStore.setState((state) => ({ character: { ...state.character, totalXp: 999 } }));

        // アカウント作成直後のクラウド: 初期行のみ
        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 1, has_more: false,
            profiles: [{ user_id: 'u1', version: 1 }],
            user_settings: [{ user_id: 'u1', version: 1 }],
            characters: [{ user_id: 'u1', total_xp: 0, gacha_count: 0, version: 1 }],
        });

        expect(applyCloudCacheToWebStores(cache)).toBe(false);
        expect(useTaskStore.getState().tasks).toEqual([localTask]);       // 消えていない
        expect(useHabitStore.getState().habits).toHaveLength(1);          // 消えていない
        expect(useGameStore.getState().character.totalXp).toBe(999);      // 初期値で上書きされていない
    });

    it('tasksが届いたセクションだけシードされ、他セクションのローカルデータは保持される', async () => {
        const { applyPullBatchToCache, createEmptyCloudCache } = await import('@life-quest/core/cloudCache');
        const { applyCloudCacheToWebStores } = await import('./cloudSync');
        const { useTaskStore } = await import('../stores/useTaskStore');
        const { useHabitStore } = await import('../stores/useHabitStore');
        const { useGameStore } = await import('../stores/useGameStore');

        useHabitStore.setState({ habits: [{ id: 'h1', name: 'ローカル習慣', categoryId: 'general', createdAt: '2026-07-01T00:00:00Z' }] });
        useGameStore.setState((state) => ({ character: { ...state.character, totalXp: 999 } }));

        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 2, has_more: false,
            characters: [{ user_id: 'u1', total_xp: 0, version: 1 }],
            tasks: [{
                id: 'cloud-1', name: 'クラウドのタスク', due_date: null, priority: 'low',
                recurrence: 'none', tags: [], completed: false, completed_at: null,
                created_at: '2026-07-05T00:00:00Z', deleted_at: null, version: 2,
            }],
        });

        expect(applyCloudCacheToWebStores(cache)).toBe(true);
        expect(useTaskStore.getState().tasks.map((task) => task.id)).toEqual(['cloud-1']); // tasksはクラウドが正
        expect(useHabitStore.getState().habits).toHaveLength(1);      // habitsは保持
        expect(useGameStore.getState().character.totalXp).toBe(999);  // gameは保持
    });

    it('stats_dailyが届いたら、ローカルの統計ログへ単調マージされる（新規端末での実績復元）', async () => {
        const { applyPullBatchToCache, createEmptyCloudCache } = await import('@life-quest/core/cloudCache');
        const { applyCloudCacheToWebStores } = await import('./cloudSync');
        const { useStatsStore } = await import('../stores/useStatsStore');

        useStatsStore.setState({ taskXpLog: {}, habitLog: {} });

        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 3, has_more: false,
            stats_daily: [
                { date: '2026-07-01', task_xp: 30, habit_count: 2, all_habits_complete: true, deleted_at: null, version: 1 },
            ],
        });

        applyCloudCacheToWebStores(cache);
        expect(useStatsStore.getState().taskXpLog).toEqual({ '2026-07-01': 30 });
        expect(useStatsStore.getState().habitLog).toEqual({ '2026-07-01': { count: 2, allComplete: true } });
    });

    it('ローカルの統計ログの方が大きい値を持つ日は後退しない', async () => {
        const { applyPullBatchToCache, createEmptyCloudCache } = await import('@life-quest/core/cloudCache');
        const { applyCloudCacheToWebStores } = await import('./cloudSync');
        const { useStatsStore } = await import('../stores/useStatsStore');

        useStatsStore.setState({ taskXpLog: { '2026-07-01': 50 }, habitLog: {} });

        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 3, has_more: false,
            stats_daily: [
                { date: '2026-07-01', task_xp: 30, habit_count: 0, all_habits_complete: false, deleted_at: null, version: 1 },
            ],
        });

        applyCloudCacheToWebStores(cache);
        expect(useStatsStore.getState().taskXpLog['2026-07-01']).toBe(50);
    });
});
