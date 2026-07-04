import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createTask } from '@life-quest/core/tasks';
import {
    markCloudSessionSeeded,
    registerMobileAuthStoreHooks,
    resetCloudSessionSeeded,
} from './authStores';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

void AsyncStorage;

describe('Mobileログアウト時のストアクリア（ADR-009）', () => {
    beforeEach(() => {
        resetCloudSessionSeeded();
        const task = createTask({ id: 'local-1', name: 'ローカルタスク', now: '2026-07-01T00:00:00.000Z' });
        useMobileTaskStore.setState({ tasks: task ? [task] : [], hasHydrated: true });
        useMobileGameStore.setState({ gachaCount: 7, hasHydrated: true });
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
        unregister();
    });

    it('クラウド未シードのログアウトはローカルデータを消さない', async () => {
        const unregister = registerMobileAuthStoreHooks();

        await notifyLogout();

        expect(useMobileTaskStore.getState().tasks.map((item) => item.id)).toEqual(['local-1']);
        expect(useMobileGameStore.getState().gachaCount).toBe(7);
        unregister();
    });
});
