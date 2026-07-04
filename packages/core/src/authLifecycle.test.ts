/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    notifyLogin,
    notifyLogout,
    registerAuthLifecycleHooks,
    resetAuthLifecycleHooks,
} from './authLifecycle';

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
});
