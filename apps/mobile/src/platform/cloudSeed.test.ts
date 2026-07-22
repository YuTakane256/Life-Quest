import { describe, expect, it, vi } from 'vitest';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
    },
}));

import { applyCloudCacheToMobileStores } from './cloudSeed';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileStatsStore } from '../stores/useMobileStatsStore';
import { useMobileSettingsStore } from '../stores/useMobileSettingsStore';

describe('applyCloudCacheToMobileStores（データ消失パターンの回帰テスト）', () => {
    it('初期行だけのクラウド状態では、既存ローカルのタスク・習慣・ゲーム状態を上書きしない', () => {
        const localTask = {
            id: 'local-1', name: 'ローカルの大事なタスク', dueDate: null, priority: 'high' as const,
            tags: [], subtasks: [], recurrence: 'none' as const, completed: false,
            completedAt: null, createdAt: '2026-07-01T00:00:00Z',
        };
        useMobileTaskStore.setState({ tasks: [localTask], hasHydrated: true });
        useMobileHabitStore.setState({
            habits: [{ id: 'h1', name: 'ローカル習慣', categoryId: 'general', createdAt: '2026-07-01T00:00:00Z' }],
        });
        useMobileGameStore.setState((state) => ({ character: { ...state.character, totalXp: 999 } }));

        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 1, has_more: false,
            profiles: [{ user_id: 'u1', version: 1 }],
            user_settings: [{ user_id: 'u1', version: 1 }],
            characters: [{ user_id: 'u1', total_xp: 0, gacha_count: 0, version: 1 }],
        });

        expect(applyCloudCacheToMobileStores(cache)).toBe(false);
        expect(useMobileTaskStore.getState().tasks).toEqual([localTask]);
        expect(useMobileHabitStore.getState().habits).toHaveLength(1);
        expect(useMobileGameStore.getState().character.totalXp).toBe(999);
    });

    it('tasksが届いたセクションだけシードされ、他セクションのローカルデータは保持される', () => {
        useMobileHabitStore.setState({
            habits: [{ id: 'h1', name: 'ローカル習慣', categoryId: 'general', createdAt: '2026-07-01T00:00:00Z' }],
        });
        useMobileGameStore.setState((state) => ({ character: { ...state.character, totalXp: 999 } }));

        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 2, has_more: false,
            characters: [{ user_id: 'u1', total_xp: 0, version: 1 }],
            tasks: [{
                id: 'cloud-1', name: 'クラウドのタスク', due_date: null, priority: 'low',
                recurrence: 'none', tags: [], completed: false, completed_at: null,
                created_at: '2026-07-05T00:00:00Z', deleted_at: null, version: 2,
            }],
        });

        expect(applyCloudCacheToMobileStores(cache)).toBe(true);
        expect(useMobileTaskStore.getState().tasks.map((task) => task.id)).toEqual(['cloud-1']);
        expect(useMobileHabitStore.getState().habits).toHaveLength(1);
        expect(useMobileGameStore.getState().character.totalXp).toBe(999);
    });

    it('stats_dailyが届いたら統計ログへ単調マージされる（新規端末での実績復元・fresh-installレース対策）', () => {
        // 新規インストール直後、ローカルコレクションが空のまま先にseedIfNeededが
        // 走って空ログを永続化してしまったケースを再現する。
        useMobileStatsStore.setState({ taskXpLog: {}, habitLog: {}, seeded: true });

        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 3, has_more: false,
            stats_daily: [
                { date: '2026-07-01', task_xp: 30, habit_count: 2, all_habits_complete: true, deleted_at: null, version: 1 },
            ],
        });

        applyCloudCacheToMobileStores(cache);
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-07-01': 30 });
        expect(useMobileStatsStore.getState().habitLog).toEqual({ '2026-07-01': { count: 2, allComplete: true } });
    });

    it('ローカルの統計ログの方が大きい値を持つ日は後退しない', () => {
        useMobileStatsStore.setState({ taskXpLog: { '2026-07-01': 50 }, habitLog: {}, seeded: true });

        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 3, has_more: false,
            stats_daily: [
                { date: '2026-07-01', task_xp: 30, habit_count: 0, all_habits_complete: false, deleted_at: null, version: 1 },
            ],
        });

        applyCloudCacheToMobileStores(cache);
        expect(useMobileStatsStore.getState().taskXpLog['2026-07-01']).toBe(50);
    });

    it('user_settings.settingsが空のままなら設定をシードしない（ローカルの既定値を保護）', () => {
        useMobileSettingsStore.setState({ themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21 });

        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 1, has_more: false,
            user_settings: [{ user_id: 'u1', settings: {}, version: 1 }],
        });

        expect(applyCloudCacheToMobileStores(cache)).toBe(false);
        expect(useMobileSettingsStore.getState()).toMatchObject({
            themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21,
        });
    });

    it('user_settings.settingsに何か書き込まれていれば同期対象4項目だけシードする（notifiedTaskIds等は保持）', () => {
        useMobileSettingsStore.setState({
            themeMode: 'system', motionMode: 'system', notificationsEnabled: false, habitReminderHour: 20,
            notifiedTaskIds: ['local-task-1'], lastHabitReminderDate: '2026-07-19',
        });

        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 2, has_more: false,
            user_settings: [{
                user_id: 'u1',
                settings: { themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 9 },
                version: 2,
            }],
        });

        expect(applyCloudCacheToMobileStores(cache)).toBe(true);
        const state = useMobileSettingsStore.getState();
        expect(state).toMatchObject({
            themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 9,
        });
        // デバイスローカルの重複通知防止状態はクラウドpullで一切変更されない
        expect(state.notifiedTaskIds).toEqual(['local-task-1']);
        expect(state.lastHabitReminderDate).toBe('2026-07-19');
    });
});
