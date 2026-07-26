import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import {
    clearWebCloudStores,
    markCloudSessionSeeded,
    registerWebAuthStoreHooks,
    resetCloudSessionSeeded,
} from './authStores';
import { useTaskStore } from '../stores/useTaskStore';
import { useTitleStore } from '../stores/useTitleStore';
import { useLoginBonusStore } from '../stores/useLoginBonusStore';

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
        clearWebCloudStores();

        expect(useTaskStore.getState().tasks).toEqual([]);
        expect(useTaskStore.getState().pendingCompletions).toEqual([]);
        expect(useTitleStore.getState().activeTitle).toBeNull();
    });
});
