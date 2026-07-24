/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    notifyLogin,
    notifyLogout,
    registerAuthLifecycleHooks,
    resetAuthLifecycleHooks,
} from './authLifecycle.ts';

afterEach(() => {
    resetAuthLifecycleHooks();
});

describe('authLifecycle', () => {
    it('notifyLoginが登録済み全フックへuserIdを渡す', async () => {
        const first = vi.fn();
        const second = vi.fn();
        registerAuthLifecycleHooks({ onLogin: first });
        registerAuthLifecycleHooks({ onLogin: second });

        await notifyLogin('user-1');

        expect(first).toHaveBeenCalledWith('user-1');
        expect(second).toHaveBeenCalledWith('user-1');
    });

    it('notifyLogoutは全フックの完了を待ってから解決する', async () => {
        const order: string[] = [];
        registerAuthLifecycleHooks({
            onLogout: async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                order.push('slow');
            },
        });
        registerAuthLifecycleHooks({ onLogout: () => { order.push('fast'); } });

        await notifyLogout();
        order.push('after-await');

        expect(order).toEqual(['slow', 'fast', 'after-await']);
    });

    it('1つのフックが例外を投げても残りのフックは実行される', async () => {
        const survivor = vi.fn();
        registerAuthLifecycleHooks({ onLogout: () => { throw new Error('boom'); } });
        registerAuthLifecycleHooks({ onLogout: survivor });

        await expect(notifyLogout()).resolves.toBeUndefined();
        expect(survivor).toHaveBeenCalled();
    });

    it('登録解除したフックは呼ばれない', async () => {
        const removed = vi.fn();
        const unregister = registerAuthLifecycleHooks({ onLogin: removed });
        unregister();

        await notifyLogin('user-1');

        expect(removed).not.toHaveBeenCalled();
    });

    it('ログイン処理中にログアウトした場合、古いログイン通知は後続フックを起動しない', async () => {
        let releaseFirst: (() => void) | undefined;
        const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const firstStarted = vi.fn();
        const laterLogin = vi.fn();
        registerAuthLifecycleHooks({
            onLogin: async () => {
                firstStarted();
                await firstGate;
            },
        });
        registerAuthLifecycleHooks({ onLogin: laterLogin });

        const login = notifyLogin('user-1');
        await vi.waitFor(() => expect(firstStarted).toHaveBeenCalledOnce());
        const logout = notifyLogout();
        releaseFirst?.();
        await Promise.all([login, logout]);

        expect(laterLogin).not.toHaveBeenCalled();
    });

    it('ログアウト処理中にログインした場合、古いログアウト通知は後続フックを停止しない', async () => {
        let releaseFirst: (() => void) | undefined;
        const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const firstStarted = vi.fn();
        const laterLogout = vi.fn();
        registerAuthLifecycleHooks({
            onLogout: async () => {
                firstStarted();
                await firstGate;
            },
        });
        registerAuthLifecycleHooks({ onLogout: laterLogout });

        const logout = notifyLogout();
        await vi.waitFor(() => expect(firstStarted).toHaveBeenCalledOnce());
        const login = notifyLogin('user-2');
        releaseFirst?.();
        await Promise.all([logout, login]);

        expect(laterLogout).not.toHaveBeenCalled();
    });
});
