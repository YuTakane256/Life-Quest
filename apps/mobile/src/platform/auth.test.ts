import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGameRewardAuthorityState, setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { consumeAnonymousRecoverySuppression } from './pendingRewardOperations';

const state = vi.hoisted(() => ({
    listener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
    },
}));

vi.mock('./supabase', () => ({
    getMobileSupabaseClient: vi.fn(() => ({
        auth: {
            // Vitest hoists mock factories before TypeScript transforms this callback.
            onAuthStateChange: vi.fn((listener) => {
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

vi.mock('./edgeFunctions', () => ({
    getMobileEdgeFunctionInvoker: vi.fn(() => null),
}));

vi.mock('./accountDeletion', () => ({
    cleanupDeletedMobileAccount: vi.fn(async () => undefined),
}));

import { startAuthSessionListener } from './auth';

describe('Mobile auth reward authority', () => {
    afterEach(() => {
        state.listener = null;
        setGameRewardAuthorityState('anonymous');
    });

    it('TOKEN_REFRESHEDでresolvingへ戻さず、保留操作の再処理を招かない', async () => {
        const stop = startAuthSessionListener();
        try {
            state.listener?.('INITIAL_SESSION', { user: { id: 'user-1' } });
            await vi.waitFor(() => expect(getGameRewardAuthorityState()).toBe('authenticated'));

            state.listener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
            expect(getGameRewardAuthorityState()).toBe('authenticated');
        } finally {
            stop();
        }
    });

    it('実SIGNED_OUTイベントはanonymous遷移前に保留キューの匿名回収を抑止する', () => {
        const stop = startAuthSessionListener();
        try {
            state.listener?.('SIGNED_OUT', null);
            expect(getGameRewardAuthorityState()).toBe('anonymous');
            expect(consumeAnonymousRecoverySuppression()).toBe(true);
        } finally {
            stop();
        }
    });
});
