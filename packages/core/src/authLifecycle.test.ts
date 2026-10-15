/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    captureAuthSessionGuard,
    captureAuthSessionScope,
    notifyLogin,
    notifyLogout,
    registerAuthLifecycleHooks,
    resetAuthLifecycleHooks,
    subscribeAuthSessionScope,
} from './authLifecycle.ts';

afterEach(() => {
    resetAuthLifecycleHooks();
});

describe('authLifecycle', () => {
    it('scope subscribers run before asynchronous lifecycle hooks and ignore same-user duplicates', async () => {
        const events: string[] = [];
        const stop = subscribeAuthSessionScope((scope) => { events.push(`scope:${scope.userId}`); });
        registerAuthLifecycleHooks({ onLogin: async (id) => { events.push(`hook:${id}`); } });
        await notifyLogin('a');
        const a = captureAuthSessionScope();
        await notifyLogin('a');
        expect(events).toEqual(['scope:a', 'hook:a', 'hook:a']);
        expect(a.userId).toBe('a');
        expect(a.isCurrent()).toBe(true);
        await notifyLogout();
        expect(a.isCurrent()).toBe(false);
        expect(events[events.length - 1]).toBe('scope:null');
        stop();
        await notifyLogin('b');
        expect(events[events.length - 1]).toBe('hook:b');
    });

    it('throwing scope subscribers cannot prevent auth cleanup', async () => {
        subscribeAuthSessionScope(() => { throw new Error('UI subscriber failed'); });
        const cleaned = vi.fn();
        registerAuthLifecycleHooks({ onLogout: cleaned });
        await notifyLogin('a');
        await notifyLogout();
        expect(cleaned).toHaveBeenCalledOnce();
    });

    it('reentrant scope transitions do not resume old scope callbacks or hooks', async () => {
        let newer!: Promise<void>;
        subscribeAuthSessionScope((scope) => { if (scope.userId === 'a') newer = notifyLogin('b'); });
        const seen: Array<string | null> = [];
        subscribeAuthSessionScope((scope) => { seen.push(scope.userId); });
        const hook = vi.fn();
        registerAuthLifecycleHooks({ onLogin: hook });
        await notifyLogin('a');
        await newer;
        expect(seen).toEqual(['b']);
        expect(hook.mock.calls).toEqual([['b']]);
    });

    it('scope guards survive duplicate same-user notifications but not A→B→A', async () => {
        const anonymous = captureAuthSessionGuard();
        await notifyLogout();
        expect(anonymous()).toBe(true);
        await notifyLogin('a');
        expect(anonymous()).toBe(false);
        const a = captureAuthSessionGuard();
        await notifyLogin('a');
        expect(a()).toBe(true);
        await notifyLogin('b');
        expect(a()).toBe(false);
        await notifyLogin('a');
        expect(a()).toBe(false);
        expect(captureAuthSessionGuard()()).toBe(true);
    });

    it('invalidates old work before an asynchronous logout hook completes', async () => {
        await notifyLogin('a');
        const a = captureAuthSessionGuard();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        registerAuthLifecycleHooks({ onLogout: () => gate });
        const logout = notifyLogout();
        expect(a()).toBe(false);
        release();
        await logout;
    });

    it('teardown invalidates existing guards even when the next user ID is the same', async () => {
        await notifyLogin('a');
        const a = captureAuthSessionGuard();
        resetAuthLifecycleHooks();
        await notifyLogin('a');
        expect(a()).toBe(false);
    });

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
