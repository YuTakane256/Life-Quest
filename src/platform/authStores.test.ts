import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import {
    clearWebCloudStores,
    markCloudSessionSeeded,
    registerWebAuthStoreHooks,
    resetCloudSessionSeeded,
    prepareWebAnonymousSession,
    CLOUD_SESSION_RECOVERY_PREFIX,
} from './authStores';
import { useTaskStore } from '../stores/useTaskStore';
import { useTitleStore } from '../stores/useTitleStore';
import { useLoginBonusStore } from '../stores/useLoginBonusStore';
import { useGameStore } from '../stores/useGameStore';
import { useHabitStore } from '../stores/useHabitStore';
import { useStatsStore } from '../stores/useStatsStore';
import { useBattleHistoryStore } from '../stores/useBattleHistoryStore';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import { applyCloudCacheToWebStores } from './cloudSync';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { flushCompletionRewardWrites, getCompletionRewardGeneration, resetCompletionRewardStorage, seedCloudCompletionRewardStorage } from './completionRewards';
import { hasPendingBattleResult } from '@life-quest/core/battle';

function task(id: string) {
    return {
        id, name: `Task ${id}`, dueDate: null, priority: 'medium' as const, tags: [],
        subtasks: [], recurrence: 'none' as const, completed: false,
        completedAt: null, createdAt: '2026-07-01T00:00:00.000Z',
    };
}

function battle() {
    return { id: 'old-battle', timestamp: '2026-10-01T00:00:00Z', stage: 1,
        enemyName: 'Enemy', enemyMaxHp: 100, enemyAttack: 5, enemyDefense: 1,
        outcome: 'victory' as const, turnCount: 2, xpEarned: 20, logs: [] };
}

describe('Webログアウト時のストアクリア（ADR-009）', () => {
    it.each([
        { seeded: false, transition: 'logout' }, { seeded: false, transition: 'switch' },
        { seeded: true, transition: 'logout' }, { seeded: true, transition: 'switch' },
    ])('旧cloud戦闘からマップへ復帰できる: $seeded / $transition', async ({ seeded, transition }) => {
        const unregister = registerWebAuthStoreHooks();
        await notifyLogin('a');
        useGameStore.setState((state) => ({ battle: { ...state.battle, status: 'victory', rewardMode: 'cloud',
            battleAttemptId: 'attempt-a', currentStage: 3, maxClearedStage: 2, battleUnlocked: true } }));
        const totalXp = useGameStore.getState().character.totalXp;
        if (seeded) markCloudSessionSeeded();
        if (transition === 'logout') await notifyLogout(); else await notifyLogin('b');
        const state = useGameStore.getState();
        expect(state.battle.status).toBe('idle');
        expect(state.battle.battleAttemptId).toBeNull();
        expect(hasPendingBattleResult('victory', state.battle.rewardMode, state.battle.battleAttemptId)).toBe(false);
        await useGameStore.persist.rehydrate();
        expect(useGameStore.getState().battle.battleAttemptId).toBeNull();
        if (!seeded) {
            expect(state.character.totalXp).toBe(totalXp);
            expect(state.battle).toMatchObject({ currentStage: 3, maxClearedStage: 2, battleUnlocked: true });
            expect(useTaskStore.getState().tasks.map((item) => item.id)).toEqual(['local-1']);
        }
        unregister();
    });

    it('初回認証復元・同一ユーザー通知ではcloud戦闘を消さない', async () => {
        const unregister = registerWebAuthStoreHooks();
        useGameStore.setState((state) => ({ battle: { ...state.battle, status: 'victory', rewardMode: 'cloud', battleAttemptId: 'restored' } }));
        await notifyLogin('a'); await notifyLogin('a');
        expect(useGameStore.getState().battle.battleAttemptId).toBe('restored');
        unregister();
    });
    it.each(['logout', 'switch'])('未seedの匿名由来ローカル戦闘と進行は保持する: %s', async (transition) => {
        const unregister = registerWebAuthStoreHooks();
        await notifyLogin('a');
        useGameStore.setState((state) => ({ battle: { ...state.battle, status: 'fighting', rewardMode: 'local', battleAttemptId: null } }));
        const previous = useGameStore.getState().battle;
        if (transition === 'logout') await notifyLogout(); else await notifyLogin('b');
        expect(useGameStore.getState().battle).toBe(previous);
        expect(useTaskStore.getState().tasks.map((item) => item.id)).toEqual(['local-1']);
        unregister();
    });
    it('ストア直接クリア後は、SDKのログアウト通知前でも遅延した習慣集計を反映しない', async () => {
        vi.useFakeTimers();
        try {
            useStatsStore.setState({ taskXpLog: {}, habitLog: {} });
            useHabitStore.setState({ habits: [{ id: 'old', name: 'Old', categoryId: 'health', createdAt: '2026-10-15T00:00:00Z' }],
                dailyRecords: [], restDays: [], allCompleteRewardDates: [] });
            useHabitStore.getState().toggleHabitCompletion('old', '2026-10-15');
            vi.runOnlyPendingTimers(); // Callback is now waiting for its stats import.
            clearWebCloudStores();
            await vi.dynamicImportSettled();
            expect(useGameStore.getState().character.totalXp).toBe(0);
            expect(useGameStore.getState().gachaCount).toBe(0);
            expect(useStatsStore.getState().habitLog).toEqual({});
        } finally { vi.useRealTimers(); }
    });

    beforeEach(() => {
        resetCloudSessionSeeded();
        useGameStore.getState().resetBattle();
        useTaskStore.setState({ tasks: [task('local-1')], pendingCompletions: [] });
        useHabitStore.setState({ habits: [{ id: 'old-habit', name: 'Old habit', categoryId: 'health', createdAt: '2026-10-01T00:00:00Z' }],
            dailyRecords: [], restDays: [], allCompleteRewardDates: [] });
        resetCompletionRewardStorage(() => useGameStore.setState((state) => ({ character: { ...state.character, totalXp: 75 } })));
        useTitleStore.setState({ activeTitle: 'ローカル称号' });
        useStatsStore.setState({ taskXpLog: { '2026-10-01': 80 }, habitLog: { '2026-10-01': { count: 3, allComplete: true } } });
        useBattleHistoryStore.setState({ history: [battle()] });
    });

    afterEach(() => {
        resetAuthLifecycleHooks();
        resetCloudSessionSeeded();
    });

    it('クラウドシード後のログアウトは、notifyLogoutの解決時点でストアが初期状態になっている', async () => {
        const unregister = registerWebAuthStoreHooks();
        markCloudSessionSeeded();

        await notifyLogout();

        // notifyLogout完了時点（＝ログアウトAPIの一部として）で即座に空
        expect(useTaskStore.getState().tasks).toEqual([]);
        expect(useTitleStore.getState().activeTitle).toBeNull();
        expect(useStatsStore.getState().taskXpLog).toEqual({});
        expect(useStatsStore.getState().habitLog).toEqual({});
        expect(useBattleHistoryStore.getState().history).toEqual([]);
        // Persisted state must not bring the previous account back on reload.
        await useStatsStore.persist.rehydrate();
        await useBattleHistoryStore.persist.rehydrate();
        expect(useStatsStore.getState().taskXpLog).toEqual({});
        expect(useBattleHistoryStore.getState().history).toEqual([]);
        unregister();
    });

    it('クラウド未シード（#503時点の通常運用）のログアウトはローカルデータを消さない', async () => {
        const unregister = registerWebAuthStoreHooks();

        await notifyLogout();

        expect(useTaskStore.getState().tasks.map((item) => item.id)).toEqual(['local-1']);
        expect(useTitleStore.getState().activeTitle).toBe('ローカル称号');
        expect(useStatsStore.getState().taskXpLog).toEqual({ '2026-10-01': 80 });
        expect(useBattleHistoryStore.getState().history).toHaveLength(1);
        unregister();
    });

    it('初回・同一ユーザーのログインは保持し、別ユーザーの後続フックより先に全表示データを隔離する', async () => {
        const unregister = registerWebAuthStoreHooks();
        await notifyLogin('user-a');
        expect(useTaskStore.getState().tasks).toHaveLength(1); // Local migration source is preserved.
        markCloudSessionSeeded();
        await notifyLogin('user-a');
        expect(useStatsStore.getState().taskXpLog).toEqual({ '2026-10-01': 80 });
        const { registerAuthLifecycleHooks } = await import('@life-quest/core/authLifecycle');
        const observed = vi.fn(() => ({
            tasks: useTaskStore.getState().tasks, habits: useHabitStore.getState().habits,
            xp: useGameStore.getState().character.totalXp, title: useTitleStore.getState().activeTitle,
            history: useBattleHistoryStore.getState().history,
            taskXpLog: useStatsStore.getState().taskXpLog, habitLog: useStatsStore.getState().habitLog,
        }));
        const unobserve = registerAuthLifecycleHooks({ onLogin: () => { observed(); } });
        await notifyLogin('user-b');
        expect(observed).toHaveBeenCalledOnce();
        expect(observed).toHaveReturnedWith({ tasks: [], habits: [], xp: 0, title: null, history: [], taskXpLog: {}, habitLog: {} });
        // The new account's monotonic merge must not inherit A's larger values.
        useStatsStore.getState().mergeFromCloud({ taskXpLog: { '2026-10-01': 10 }, habitLog: {} });
        expect(useStatsStore.getState().taskXpLog).toEqual({ '2026-10-01': 10 });
        markCloudSessionSeeded();
        await notifyLogout();
        expect(useStatsStore.getState().taskXpLog).toEqual({});
        unobserve();
        unregister();
    });

    it('クラウド統計だけを反映したセッションもログアウト時にクリアする', async () => {
        registerWebAuthStoreHooks();
        await notifyLogin('stats-only');
        const cache = applyPullBatchToCache(createEmptyCloudCache(), {
            next_cursor: 1, has_more: false,
            stats_daily: [{ date: '2026-10-02', task_xp: 20, habit_count: 1, all_habits_complete: false, version: 1 }],
        });
        if (applyCloudCacheToWebStores(cache)) markCloudSessionSeeded();
        await notifyLogout();
        expect(useStatsStore.getState().taskXpLog).toEqual({});
        expect(useStatsStore.getState().habitLog).toEqual({});
    });

    it('未シードのまま別ユーザー通知になっても匿名移行元を消さない', async () => {
        registerWebAuthStoreHooks();
        await notifyLogin('user-a');
        await notifyLogin('user-b');
        expect(useTaskStore.getState().tasks.map((item) => item.id)).toEqual(['local-1']);
        expect(useStatsStore.getState().taskXpLog).toEqual({ '2026-10-01': 80 });
        expect(useBattleHistoryStore.getState().history.map((entry) => entry.id)).toEqual(['old-battle']);
    });

    it('ログインボーナスはクラウドシードの有無に関係なくログアウト時に即時隔離する', async () => {
        const unregister = registerWebAuthStoreHooks();
        useLoginBonusStore.setState({
            activeCloudUserId: 'user-a',
            lastLoginDate: '2026-07-26',
            streak: 4,
            pendingBonus: { date: '2026-07-26', streak: 4, xp: 35, chestLabel: null },
            claimStatus: 'retryable-error',
            claimMessage: '通信を確認してください。',
            anonymousState: { lastLoginDate: '2026-07-20', streak: 2 },
        });

        await notifyLogout();

        expect(useLoginBonusStore.getState()).toMatchObject({
            activeCloudUserId: null,
            lastLoginDate: '2026-07-20',
            streak: 2,
            pendingBonus: null,
            claimStatus: 'idle',
            claimMessage: null,
        });
        unregister();
    });

    it('別ユーザーのログイン通知で前アカウントのボーナス状態を即時隔離する', async () => {
        const unregister = registerWebAuthStoreHooks();
        useLoginBonusStore.setState({
            activeCloudUserId: 'user-a',
            lastLoginDate: '2026-07-26',
            streak: 4,
            pendingBonus: { date: '2026-07-26', streak: 4, xp: 35, chestLabel: null },
        });

        await notifyLogin('user-b');

        expect(useLoginBonusStore.getState()).toMatchObject({
            activeCloudUserId: 'user-b', lastLoginDate: null, streak: 0, pendingBonus: null,
        });
        unregister();
    });

    it('clearWebCloudStoresは全対象ストアを初期状態へ戻す', () => {
        setGameRewardAuthorityState('anonymous');
        resetCompletionRewardStorage(() => useGameStore.setState({ completionRewardKeys: ['task:previous-user'] }));
        clearWebCloudStores();
        expect(useGameStore.getState().completionRewardKeys).toEqual([]);
        expect(JSON.parse(localStorage.getItem('quest-board-game')!).state.completionRewardKeys).toEqual([]);
        expect(JSON.parse(localStorage.getItem('quest-board-game')!).state.completionRewardScope).toBe('anonymous');

        expect(useTaskStore.getState().tasks).toEqual([]);
        expect(useTaskStore.getState().pendingCompletions).toEqual([]);
        expect(useTitleStore.getState().activeTitle).toBeNull();
    });
});

describe('expired cloud session cache isolation', () => {
    beforeEach(async () => {
        await flushCompletionRewardWrites();
        localStorage.clear();
        vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => unknown) => work() } });
        setGameRewardAuthorityState('resolving');
        resetCloudSessionSeeded();
        seedCloudCompletionRewardStorage(() => useGameStore.setState({
            character: { ...useGameStore.getState().character, totalXp: 110 }, completionRewardKeys: ['task:cloud-paid'],
        }));
        useTaskStore.setState({ tasks: [task('cloud-only')], pendingCompletions: [] });
        useStatsStore.setState({ taskXpLog: { '2026-10-01': 80 }, habitLog: {} });
        useBattleHistoryStore.setState({ history: [battle()] });
        await flushCompletionRewardWrites();
    });
    afterEach(async () => { await flushCompletionRewardWrites(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    it('archives cloud data before starting fresh anonymous progress, which survives reload', async () => {
        const oldGame = localStorage.getItem('quest-board-game');
        const oldTasks = localStorage.getItem('quest-board-tasks');
        const oldStats = localStorage.getItem('quest-board-stats');
        const oldHistory = localStorage.getItem('quest-board-battle-history');
        await prepareWebAnonymousSession();
        const recoveryKeys = Object.keys(localStorage).filter((key) => key.startsWith(CLOUD_SESSION_RECOVERY_PREFIX));
        expect(recoveryKeys).toHaveLength(1);
        const archive = JSON.parse(localStorage.getItem(recoveryKeys[0])!);
        expect(archive.slots).toMatchObject({ 'quest-board-game': oldGame, 'quest-board-tasks': oldTasks });
        expect(archive.slots).toMatchObject({ 'quest-board-stats': oldStats, 'quest-board-battle-history': oldHistory });
        expect(useStatsStore.getState().taskXpLog).toEqual({});
        expect(useStatsStore.getState().habitLog).toEqual({});
        expect(useTaskStore.getState().tasks).toEqual([]);
        expect(useGameStore.getState().completionRewardKeys).toEqual([]);
        setGameRewardAuthorityState('anonymous');
        expect(await useGameStore.getState().grantCompletionReward('task:new', 20, getCompletionRewardGeneration())).toBe(true);
        await useGameStore.persist.rehydrate();
        expect(useGameStore.getState().character.totalXp).toBe(20);
        await prepareWebAnonymousSession();
        expect(Object.keys(localStorage).filter((key) => key.startsWith(CLOUD_SESSION_RECOVERY_PREFIX))).toHaveLength(1);
    });

    it('never clears the cloud original when archive storage fails', async () => {
        const original = localStorage.getItem('quest-board-game');
        const write = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
            if (key.startsWith(CLOUD_SESSION_RECOVERY_PREFIX)) throw new DOMException('quota', 'QuotaExceededError');
            write.call(this, key, value);
        });
        await expect(prepareWebAnonymousSession()).rejects.toThrow();
        expect(localStorage.getItem('quest-board-game')).toBe(original);
        expect(useTaskStore.getState().tasks.map((value) => value.id)).toEqual(['cloud-only']);
        expect(useStatsStore.getState().taskXpLog).toEqual({ '2026-10-01': 80 });
        expect(useBattleHistoryStore.getState().history.map((value) => value.id)).toEqual(['old-battle']);
        expect(useGameStore.getState().completionRewardError).toContain('再ログイン');
    });

    it('does not reset a newer login or a normal anonymous save', async () => {
        await prepareWebAnonymousSession(() => false);
        expect(useGameStore.getState().completionRewardKeys).toEqual(['task:cloud-paid']);
        resetCompletionRewardStorage(() => useGameStore.setState({ completionRewardKeys: ['task:local-paid'] }));
        await flushCompletionRewardWrites();
        await prepareWebAnonymousSession();
        expect(useGameStore.getState().completionRewardKeys).toEqual(['task:local-paid']);
        expect(Object.keys(localStorage).filter((key) => key.startsWith(CLOUD_SESSION_RECOVERY_PREFIX))).toHaveLength(0);
    });
});
