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
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { flushCompletionRewardWrites, getCompletionRewardGeneration, resetCompletionRewardStorage, seedCloudCompletionRewardStorage } from './completionRewards';

function task(id: string) {
    return {
        id, name: `Task ${id}`, dueDate: null, priority: 'medium' as const, tags: [],
        subtasks: [], recurrence: 'none' as const, completed: false,
        completedAt: null, createdAt: '2026-07-01T00:00:00.000Z',
    };
}

describe('Webログアウト時のストアクリア（ADR-009）', () => {
    beforeEach(() => {
        resetCloudSessionSeeded();
        useTaskStore.setState({ tasks: [task('local-1')], pendingCompletions: [] });
        useTitleStore.setState({ activeTitle: 'ローカル称号' });
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
        unregister();
    });

    it('クラウド未シード（#503時点の通常運用）のログアウトはローカルデータを消さない', async () => {
        const unregister = registerWebAuthStoreHooks();

        await notifyLogout();

        expect(useTaskStore.getState().tasks.map((item) => item.id)).toEqual(['local-1']);
        expect(useTitleStore.getState().activeTitle).toBe('ローカル称号');
        unregister();
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
        await flushCompletionRewardWrites();
    });
    afterEach(async () => { await flushCompletionRewardWrites(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    it('archives cloud data before starting fresh anonymous progress, which survives reload', async () => {
        const oldGame = localStorage.getItem('quest-board-game');
        const oldTasks = localStorage.getItem('quest-board-tasks');
        await prepareWebAnonymousSession();
        const recoveryKeys = Object.keys(localStorage).filter((key) => key.startsWith(CLOUD_SESSION_RECOVERY_PREFIX));
        expect(recoveryKeys).toHaveLength(1);
        const archive = JSON.parse(localStorage.getItem(recoveryKeys[0])!);
        expect(archive.slots).toMatchObject({ 'quest-board-game': oldGame, 'quest-board-tasks': oldTasks });
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
