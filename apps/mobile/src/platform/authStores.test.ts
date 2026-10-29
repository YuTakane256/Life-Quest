import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, registerAuthLifecycleHooks, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createTask } from '@life-quest/core/tasks';
import {
    markCloudSessionSeeded,
    registerMobileAuthStoreHooks,
    resetCloudSessionSeeded,
} from './authStores';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileStatsStore } from '../stores/useMobileStatsStore';
import { useMobileTitleStore } from '../stores/useMobileTitleStore';
import { applyCloudCacheToMobileStores } from './cloudSeed';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import { hasPendingBattleResult } from '@life-quest/core/battle';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

vi.mock('../stores/useMobileLoginBonusStore', () => ({
    beginMobileLoginBonusCloudSession: vi.fn(),
    clearMobileLoginBonusCloudSession: vi.fn(),
}));

void AsyncStorage;

describe('Mobileログアウト時のストアクリア（ADR-009）', () => {
    it('再起動後にpull未完了でも保存済み所有者の明示ログアウトでは表示を片付ける', async () => {
        const { MOBILE_CLOUD_DISPLAY_OWNER_KEY } = await import('./cloudSessionRecovery');
        registerMobileAuthStoreHooks();
        await notifyLogin('a');
        vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce('a').mockResolvedValueOnce('a');
        await notifyLogout();
        expect(useMobileTaskStore.getState().tasks).toEqual([]);
        expect(AsyncStorage.removeItem).toHaveBeenCalledWith(MOBILE_CLOUD_DISPLAY_OWNER_KEY);
    });

    it('保存済み所有者を読む間に新しいログインが始まったら古いログアウトはクリアしない', async () => {
        registerMobileAuthStoreHooks();
        await notifyLogin('a');
        let finish!: (value: string) => void;
        vi.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const leaving = notifyLogout();
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        await notifyLogin('b');
        finish('a');
        await leaving;
        expect(useMobileTaskStore.getState().tasks.map((task) => task.id)).toEqual(['local-1']);
    });
    it.each(['logout', 'switch'])('未seedでも旧宝箱演出は破棄するが報酬は消さない: %s', async (transition) => {
        const unregister = registerMobileAuthStoreHooks();
        await notifyLogin('a');
        useMobileGameStore.setState({ chestQueue: [{ id: 'reveal', chestType: 'wood', label: '木の宝箱', opened: false, equipment: null }] });
        const equipment = useMobileGameStore.getState().openChest('reveal');
        expect(useMobileGameStore.getState().pendingChestReveal).not.toBeNull();
        await notifyLogin('a');
        expect(useMobileGameStore.getState().pendingChestReveal).not.toBeNull();
        if (transition === 'logout') await notifyLogout(); else await notifyLogin('b');
        expect(useMobileGameStore.getState().pendingChestReveal).toBeNull();
        expect(useMobileGameStore.getState().equipment).toContainEqual(equipment);
        unregister();
    });
    function setCloudBattle() {
        useMobileGameStore.getState().startCloudBattle(3, 'attempt-a', {
            player: { attack: 10, defense: 5, maxHp: 50 }, enemy: { stage: 3, name: 'enemy', maxHp: 10, attack: 1, defense: 1, xpReward: 5 },
            playerName: 'hero', playerLevel: 1,
        });
        const battle = useMobileGameStore.getState().activeBattle!;
        useMobileGameStore.setState({ activeBattle: { ...battle, state: { ...battle.state, outcome: 'victory' } } });
    }
    it.each([
        { seeded: false, transition: 'logout' }, { seeded: false, transition: 'switch' },
        { seeded: true, transition: 'logout' }, { seeded: true, transition: 'switch' },
    ])('旧cloud戦闘からマップへ復帰できる: $seeded / $transition', async ({ seeded, transition }) => {
        const unregister = registerMobileAuthStoreHooks();
        await notifyLogin('a'); setCloudBattle();
        const previous = useMobileGameStore.getState();
        expect(hasPendingBattleResult('victory', 'cloud', previous.activeBattle!.battleAttemptId)).toBe(true);
        if (seeded) markCloudSessionSeeded();
        if (transition === 'logout') await notifyLogout(); else await notifyLogin('b');
        const current = useMobileGameStore.getState();
        expect(current.activeBattle).toBeNull();
        if (!seeded) {
            expect(current.battleProgress).toEqual(previous.battleProgress);
            expect(current.character).toEqual(previous.character);
            expect(current.gachaCount).toBe(7);
            expect(useMobileTaskStore.getState().tasks.map((item) => item.id)).toEqual(['local-1']);
        }
        unregister();
    });
    it('初回認証復元・同一ユーザー通知ではcloud戦闘を消さない', async () => {
        const unregister = registerMobileAuthStoreHooks(); setCloudBattle();
        await notifyLogin('a'); await notifyLogin('a');
        expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe('attempt-a');
        unregister();
    });
    it.each(['logout', 'switch'])('未seedの匿名由来ローカル戦闘と進行は保持する: %s', async (transition) => {
        const unregister = registerMobileAuthStoreHooks();
        await notifyLogin('a'); setCloudBattle();
        useMobileGameStore.setState((state) => ({ activeBattle: { ...state.activeBattle!, rewardMode: 'local', battleAttemptId: null } }));
        const previous = useMobileGameStore.getState().activeBattle;
        if (transition === 'logout') await notifyLogout(); else await notifyLogin('b');
        expect(useMobileGameStore.getState().activeBattle).toBe(previous);
        expect(useMobileTaskStore.getState().tasks.map((item) => item.id)).toEqual(['local-1']);
        unregister();
    });
    beforeEach(() => {
        resetCloudSessionSeeded();
        const task = createTask({ id: 'local-1', name: 'ローカルタスク', now: '2026-07-01T00:00:00.000Z' });
        useMobileTaskStore.setState({ tasks: task ? [task] : [], hasHydrated: true });
        useMobileGameStore.setState({ gachaCount: 7, hasHydrated: true, activeBattle: null });
        useMobileHabitStore.setState({ habits: [{ id: 'old-habit', name: 'Old habit', categoryId: 'health', createdAt: '2026-10-01T00:00:00Z' }],
            records: [], restDays: [], rewardEligibleDates: [] });
        useMobileStatsStore.setState({ taskXpLog: { '2026-10-01': 80 }, habitLog: { '2026-10-01': { count: 3, allComplete: true } }, seeded: true, hasHydrated: true });
        useMobileTitleStore.setState({ activeTitle: 'Old title' });
    });

    afterEach(() => {
        resetAuthLifecycleHooks();
        resetCloudSessionSeeded();
    });

    it('クラウドシード後のログアウトでストアが即座に初期状態へ戻る', async () => {
        const unregister = registerMobileAuthStoreHooks();
        markCloudSessionSeeded();

        await notifyLogout();

        expect(useMobileTaskStore.getState().tasks).toEqual([]);
        expect(useMobileGameStore.getState().gachaCount).toBe(0);
        expect(useMobileTitleStore.getState().activeTitle).toBeNull();
        expect(useMobileStatsStore.getState()).toMatchObject({ taskXpLog: {}, habitLog: {}, seeded: false, hasHydrated: true });
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({});
        expect(useMobileStatsStore.getState().habitLog).toEqual({});
        const writes = vi.mocked(AsyncStorage.setItem).mock.calls;
        const statsWrite = writes.filter(([key]) => key === 'quest-board-mobile-stats').at(-1);
        expect(JSON.parse(statsWrite![1]).state).toEqual({ taskXpLog: {}, habitLog: {}, seeded: false });
        const titleWrite = writes.filter(([key]) => key === 'quest-board-title').at(-1);
        expect(JSON.parse(titleWrite![1]).state.activeTitle).toBeNull();
        unregister();
    });

    it('クラウド未シードのログアウトはローカルデータを消さない', async () => {
        const unregister = registerMobileAuthStoreHooks();

        await notifyLogout();

        expect(useMobileTaskStore.getState().tasks.map((item) => item.id)).toEqual(['local-1']);
        expect(useMobileGameStore.getState().gachaCount).toBe(7);
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-10-01': 80 });
        expect(useMobileTitleStore.getState().activeTitle).toBe('Old title');
        unregister();
    });

    it('初回・同一ユーザーのログインは保持し、別ユーザーの後続フックより先に全表示データを隔離する', async () => {
        registerMobileAuthStoreHooks();
        await notifyLogin('user-a');
        expect(useMobileTaskStore.getState().tasks).toHaveLength(1);
        markCloudSessionSeeded();
        await notifyLogin('user-a');
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-10-01': 80 });
        const observed = vi.fn(() => ({
            tasks: useMobileTaskStore.getState().tasks, habits: useMobileHabitStore.getState().habits,
            chests: useMobileGameStore.getState().gachaCount, title: useMobileTitleStore.getState().activeTitle,
            taskXpLog: useMobileStatsStore.getState().taskXpLog, habitLog: useMobileStatsStore.getState().habitLog,
            seeded: useMobileStatsStore.getState().seeded,
        }));
        registerAuthLifecycleHooks({ onLogin: () => { observed(); } });
        await notifyLogin('user-b');
        expect(observed).toHaveBeenCalledOnce();
        expect(observed).toHaveReturnedWith({ tasks: [], habits: [], chests: 0, title: null, taskXpLog: {}, habitLog: {}, seeded: false });
        useMobileStatsStore.getState().mergeFromCloud({ taskXpLog: { '2026-10-01': 10 }, habitLog: {} });
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-10-01': 10 });
        markCloudSessionSeeded();
        await notifyLogout();
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({});
    });

    it('クラウド統計だけを反映したセッションもログアウト時にクリアする', async () => {
        registerMobileAuthStoreHooks();
        await notifyLogin('stats-only');
        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 1, has_more: false,
            stats_daily: [{ date: '2026-10-02', task_xp: 20, habit_count: 1, all_habits_complete: false, version: 1 }],
        });
        if (applyCloudCacheToMobileStores(cache)) markCloudSessionSeeded();
        await notifyLogout();
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({});
        expect(useMobileStatsStore.getState().habitLog).toEqual({});
    });

    it('未シードのまま別ユーザー通知になっても匿名移行元を消さない', async () => {
        registerMobileAuthStoreHooks();
        await notifyLogin('user-a');
        await notifyLogin('user-b');
        expect(useMobileTaskStore.getState().tasks.map((item) => item.id)).toEqual(['local-1']);
        expect(useMobileStatsStore.getState().taskXpLog).toEqual({ '2026-10-01': 80 });
        expect(useMobileTitleStore.getState().activeTitle).toBe('Old title');
    });
});
