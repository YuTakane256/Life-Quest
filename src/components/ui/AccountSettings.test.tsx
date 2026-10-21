import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAuthSessionScope, notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import type { AccountDeletionResult } from '@life-quest/core/accountDeletion';

const mocks = vi.hoisted(() => ({ user: vi.fn(), remove: vi.fn(), change: (_value: string) => {}, submit: () => {},
    capture: (value: unknown) => {
        const props = value as Record<string, unknown> | null;
        if (props?.['aria-label'] === '退会確認文字') mocks.change = (value) => (props.onChange as (event: unknown) => void)({ target: { value } });
        if (props?.children === '完全に削除する') mocks.submit = props.onClick as () => void;
    },
}));
vi.mock('react/jsx-runtime', async (original) => { const module = await original<typeof import('react/jsx-runtime')>(); return { ...module,
    jsx: (...args: Parameters<typeof module.jsx>) => { mocks.capture(args[1]); return module.jsx(...args); }, jsxs: (...args: Parameters<typeof module.jsxs>) => { mocks.capture(args[1]); return module.jsxs(...args); },
}; });
vi.mock('react/jsx-dev-runtime', async (original) => { const module = await original<typeof import('react/jsx-dev-runtime')>(); return { ...module,
    jsxDEV: (...args: Parameters<typeof module.jsxDEV>) => { mocks.capture(args[1]); return module.jsxDEV(...args); },
}; });
vi.mock('../../platform/supabase', () => ({ readWebSupabaseEnv: () => ({ url: 'https://example.invalid', anonKey: 'fixture' }) }));
vi.mock('../../platform/auth', () => ({ getCurrentUser: mocks.user, deleteCurrentAccount: mocks.remove,
    getPasswordRecoveryState: () => 'idle', getGoogleOAuthState: () => ({ status: 'idle' }),
    subscribePasswordRecoveryState: () => () => {}, subscribeGoogleOAuthState: () => () => {}, subscribeAppleOAuthState: () => () => {},
    cancelPasswordRecovery: vi.fn(), requestPasswordReset: vi.fn(), resendEmailVerification: vi.fn(), signInWithEmail: vi.fn(),
    signInWithApple: vi.fn(), signInWithGoogle: vi.fn(), signOutUser: vi.fn(), signUpWithEmail: vi.fn(), updatePasswordFromRecovery: vi.fn(),
}));
import { AccountSettings } from './AccountSettings';

let root: Root; let host: HTMLDivElement;
const button = (text: string) => [...host.querySelectorAll('button')].find((node) => node.textContent === text)!;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const render = () => act(async () => root.render(createElement(StrictMode, {}, createElement(AccountSettings))));
const open = () => act(() => button('アカウントを削除').click());
const type = (text = '削除') => act(() => mocks.change(text));
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.user.mockReset().mockImplementation(async () => { const userId = captureAuthSessionScope().userId; return userId ? { userId, email: `${userId}@example.invalid` } : null; });
    mocks.remove.mockReset().mockResolvedValue({ ok: false, message: 'fixture: 未送信' });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals(); });

describe('Web退会UIの確認対象と操作寿命', () => {
    it('対象を明示し、正確な確認文字を必須にして連打を一度だけ処理する', async () => {
        const wait = deferred<AccountDeletionResult>(); mocks.remove.mockReturnValueOnce(wait.promise);
        await render(); open(); expect(host.textContent).toContain('「a@example.invalid」のクラウド');
        expect(button('完全に削除する').disabled).toBe(true); type('削除 '); expect(button('完全に削除する').disabled).toBe(true); type();
        const submit = mocks.submit; act(() => { submit(); submit(); }); expect(mocks.remove).toHaveBeenCalledOnce();
        expect(mocks.remove.mock.calls[0][0].userId).toBe('a'); await act(async () => wait.resolve({ ok: false, message: '再確認用の案内' }));
        expect(host.textContent).toContain('再確認用の案内'); expect(button('完全に削除する').disabled).toBe(false);
    });
    it('自分の退会によるログアウト後もApple手動解除の案内を表示する', async () => {
        mocks.remove.mockImplementationOnce(async () => { await notifyLogout(); return { ok: true, manualAppleRevocationRequired: true, completionScope: captureAuthSessionScope().isCurrent }; });
        await render(); open(); type(); await act(async () => mocks.submit());
        expect(host.textContent).toContain('Appleの「Apple IDを使用中のApp」'); expect(host.querySelector('[aria-label="退会確認文字"]')).toBeNull();
    });
    it.each(['switch', 'logout', 'roundtrip', 'cancel', 'text', 'unmount'])('%s後の古いボタンは送信しない', async (kind) => {
        await render(); open(); type(); const old = mocks.submit;
        await act(async () => {
            if (kind === 'switch') await notifyLogin('b');
            if (kind === 'logout') await notifyLogout();
            if (kind === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); }
            if (kind === 'cancel') button('キャンセル').click();
            if (kind === 'text') mocks.change('');
            if (kind === 'unmount') root.unmount();
        });
        act(() => old()); expect(mocks.remove).not.toHaveBeenCalled();
        if (kind === 'switch') { expect(host.textContent).toContain('b@example.invalid'); expect(host.textContent).not.toContain('a@example.invalid'); }
    });
    it('別アカウントの新要求を古い結果・finallyで終了しない', async () => {
        const old = deferred<AccountDeletionResult>(); const current = deferred<AccountDeletionResult>();
        mocks.remove.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        await render(); open(); type(); act(() => mocks.submit());
        await act(async () => notifyLogin('b')); open(); type(); act(() => mocks.submit());
        await act(async () => old.resolve({ ok: false, message: 'aの古い失敗' }));
        expect(host.textContent).not.toContain('aの古い失敗'); expect(button('削除中').disabled).toBe(true);
        await act(async () => current.resolve({ ok: false, message: 'bの再確認' })); expect(host.textContent).toContain('bの再確認');
    });
    it('古いアカウント照会があとから成功してもBへAを表示しない', async () => {
        const old = deferred<{ userId: string; email: string }>(); mocks.user.mockReturnValueOnce(old.promise);
        await render(); await act(async () => notifyLogin('b'));
        await act(async () => old.resolve({ userId: 'a', email: 'a@example.invalid' }));
        expect(host.textContent).toContain('b@example.invalid'); expect(host.textContent).not.toContain('a@example.invalid');
    });
});
