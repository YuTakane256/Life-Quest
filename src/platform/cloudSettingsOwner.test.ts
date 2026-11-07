import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { applyPullBatchToCache, createEmptyCloudCache, type CloudCache } from '@life-quest/core/cloudCache';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { applyCloudCacheToWebStores } from './cloudSync';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from './completionRewards';
import { useGameStore } from '../stores/useGameStore';
import { useThemeStore } from '../stores/useThemeStore';
import { useMotionStore } from '../stores/useMotionStore';
import { useNotificationStore } from '../stores/useNotificationStore';
import { enqueueCloudOperation as webEnqueue } from './cloudOutbox';
import { applyCloudCacheToMobileStores } from '../../apps/mobile/src/platform/cloudSeed';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';
import { useMobileSettingsStore } from '../../apps/mobile/src/stores/useMobileSettingsStore';
import { enqueueCloudOperation as mobileEnqueue } from '../../apps/mobile/src/platform/cloudOutbox';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) } }));
vi.mock('./cloudOutbox', async (original) => ({ ...await original<typeof import('./cloudOutbox')>(), enqueueCloudOperation: vi.fn(async () => true) }));
vi.mock('../../apps/mobile/src/platform/cloudOutbox', async (original) => ({ ...await original<typeof import('../../apps/mobile/src/platform/cloudOutbox')>(), enqueueCloudOperation: vi.fn(async () => true) }));

const wanted = { themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 7 } as const;
const current = { themeMode: 'light', motionMode: 'standard', notificationsEnabled: false, habitReminderHour: 22 } as const;
function settingsCache(userId = 'a', settings: unknown = wanted, version = 2): CloudCache {
    return applyPullBatchToCache(createEmptyCloudCache(), { next_cursor: version, has_more: false, user_settings: [{ user_id: userId, settings, version }] });
}
function resetSettings() {
    useThemeStore.setState({ mode: 'light' }); useMotionStore.setState({ mode: 'standard' });
    useNotificationStore.setState({ enabled: false, habitReminderHour: 22, notifiedTaskIds: ['local-task'], lastHabitReminderDate: '2026-11-06' });
    useMobileSettingsStore.setState({ ...current, notifiedTaskIds: ['local-task'], lastHabitReminderDate: '2026-11-06', hasHydrated: true });
}
const platforms = [
    { name: 'Web', seed: applyCloudCacheToWebStores, game: useGameStore, read: () => ({ themeMode: useThemeStore.getState().mode, motionMode: useMotionStore.getState().mode, notificationsEnabled: useNotificationStore.getState().enabled, habitReminderHour: useNotificationStore.getState().habitReminderHour }), history: () => useNotificationStore.getState() },
    { name: 'Mobile', seed: applyCloudCacheToMobileStores, game: useMobileGameStore, read: () => { const { themeMode, motionMode, notificationsEnabled, habitReminderHour } = useMobileSettingsStore.getState(); return { themeMode, motionMode, notificationsEnabled, habitReminderHour }; }, history: () => useMobileSettingsStore.getState() },
];
beforeEach(async () => {
    await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); await notifyLogin('a'); localStorage.clear();
    withoutCompletionRewardPersistence(() => useGameStore.setState(useGameStore.getInitialState()));
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true }); resetSettings();
    vi.mocked(webEnqueue).mockClear(); vi.mocked(mobileEnqueue).mockClear();
});
afterEach(async () => { vi.restoreAllMocks(); await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); localStorage.clear(); });

describe.each(platforms)('$name: 受信設定の所有者と認証境界', ({ seed, read, history, game }) => {
    it('本人の明示4項目だけを反映し、通知済み履歴や送信を変更しない', () => {
        expect(seed(settingsCache('a', { ...wanted, notifiedTaskIds: ['remote'], lastHabitReminderDate: '2099-01-01' }))).toBe(true);
        expect(read()).toEqual(wanted); expect(history()).toMatchObject({ notifiedTaskIds: ['local-task'], lastHabitReminderDate: '2026-11-06' });
        expect(webEnqueue).not.toHaveBeenCalled(); expect(mobileEnqueue).not.toHaveBeenCalled();
    });
    it('本人の明示的な既定値/通知OFFも反映する', () => {
        seed(settingsCache('a', { themeMode: 'system', motionMode: 'system', notificationsEnabled: false, habitReminderHour: 20 }));
        expect(read()).toEqual({ themeMode: 'system', motionMode: 'system', notificationsEnabled: false, habitReminderHour: 20 });
    });
    it('既知項目の不正な値は従来の正規化を通し、部分設定の互換性を維持する', () => {
        seed(settingsCache('a', { themeMode: 'unknown', habitReminderHour: 99 }));
        expect(read()).toEqual({ themeMode: 'system', motionMode: 'system', notificationsEnabled: false, habitReminderHour: 23 });
    });
    it.each(['別所有者', 'PKと所有者の不一致', '削除済み', '初期版', '不正な版', '配列', '空', '未知の項目だけ'])('%sの保存/受信行を現在設定へ適用しない', (kind) => {
        const cache = settingsCache(kind === '別所有者' ? 'b' : 'a');
        if (kind === 'PKと所有者の不一致') cache.user_settings.a.user_id = 'b';
        if (kind === '削除済み') cache.user_settings.a.deleted_at = '2026-11-07T00:00:00Z';
        if (kind === '初期版') cache.user_settings.a.version = 1;
        if (kind === '不正な版') cache.user_settings.a.version = 2.5;
        if (kind === '配列') cache.user_settings.a.settings = ['dark'];
        if (kind === '空') cache.user_settings.a.settings = {};
        if (kind === '未知の項目だけ') cache.user_settings.a.settings = { ignored: true };
        expect(seed(cache)).toBe(false); expect(read()).toEqual(current);
    });
    it('別所有者の行が先にあっても、本人のPKの行を選ぶ', () => {
        const cache = settingsCache('b', current);
        cache.user_settings.a = settingsCache().user_settings.a;
        seed(cache); expect(read()).toEqual(wanted);
    });
    it('匿名状態へ本人向けキャッシュの設定を反映しない', async () => {
        await notifyLogout(); seed(settingsCache()); expect(read()).toEqual(current);
    });
    it('ゲーム受信中のA→B切替後にAの設定を適用しない', async () => {
        let changed: Promise<void> | undefined;
        const off = game.subscribe((state) => { if (!changed && state.character.totalXp === 500) { changed = notifyLogin('b'); resetSettings(); } });
        try {
            const cache = applyPullBatchToCache(settingsCache(), { next_cursor: 3, has_more: false, characters: [{ user_id: 'a', total_xp: 500, version: 3 }] });
            seed(cache); await changed; expect(read()).toEqual(current);
        } finally { off(); }
    });
});

it.each(['b', 'logout', 'a-after-logout'])('Webはテーマ反映中の%sへの認証切替後、旧Aのモーション/通知を続けて反映しない', async (next) => {
    let changed: Promise<void> | undefined;
    const off = useThemeStore.subscribe((state) => { if (!changed && state.mode === 'dark') { changed = next === 'b' ? notifyLogin('b') : (async () => { await notifyLogout(); if (next === 'a-after-logout') await notifyLogin('a'); })(); resetSettings(); } });
    try { applyCloudCacheToWebStores(settingsCache()); await changed; expect(platforms[0].read()).toEqual(current); }
    finally { off(); }
});
