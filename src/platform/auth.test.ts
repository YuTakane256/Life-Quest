import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGameRewardAuthorityState, setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import {
    clearPendingWebRewardOperations,
    deferWebRewardOperation,
    getPendingWebRewardOperations,
    pendingWebRewardOperationsKey,
    restorePendingWebRewardOperations,
} from './pendingRewardOperations';

const state = vi.hoisted(() => ({
    listener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));

vi.mock('./supabase', () => ({
    getWebSupabaseClient: vi.fn(() => ({
        auth: {
            onAuthStateChange: vi.fn((listener: typeof state.listener) => {
                state.listener = listener;
                return { data: { subscription: { unsubscribe: vi.fn() } } };
            }),
        },
    })),
}));

vi.mock('@life-quest/core/authLifecycle', () => ({
    notifyLogin: vi.fn(async () => undefined),
    notifyLogout: vi.fn(async () => undefined),
}));

import { startAuthSessionListener } from './auth';

describe('Web auth pending reward ownership', () => {
    afterEach(() => {
        state.listener = null;
        setGameRewardAuthorityState('anonymous');
        clearPendingWebRewardOperations();
        localStorage.clear();
    });

    it('SIGNED_OUTは保留メモリを切り離し、同じuser namespaceの保存キーは残す', () => {
        restorePendingWebRewardOperations('user-a');
        deferWebRewardOperation({ key: 'task-1', priority: 'medium', completedAt: '2026-07-29T00:00:00.000Z', xpReward: 20 });
        const stop = startAuthSessionListener();
        try {
            state.listener?.('SIGNED_OUT', null);
            expect(getGameRewardAuthorityState()).toBe('anonymous');
            expect(getPendingWebRewardOperations()).toEqual([]);
            expect(localStorage.getItem(pendingWebRewardOperationsKey('user-a'))).toContain('task-1');
        } finally {
            stop();
        }
    });
});
