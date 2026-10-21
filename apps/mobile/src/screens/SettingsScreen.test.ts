import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAuthSessionScope, notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import type { AccountDeletionResult } from '@life-quest/core/accountDeletion';

const mocks = vi.hoisted(() => ({ user: vi.fn(), pending: vi.fn(), approve: vi.fn(), permission: vi.fn(), enqueue: vi.fn(async () => true),
    toggle: (_enabled: boolean) => {}, blur: () => {}, focus: () => {},
    blurs: new Set<() => void>(), focuses: new Set<() => void>(), remove: vi.fn(),
    deleteText: (_value: string) => {}, deletePress: () => {},
    identities: new Set<(userId: string | null) => void>(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined), getAllKeys: vi.fn(async () => []),
} }));
vi.mock('react-native', async () => {
    const { createElement: element } = await import('react');
    type Props = { children?: ReactNode; accessibilityLabel?: string; accessibilityRole?: string;
        onPress?: () => void; disabled?: boolean; value?: string; onChangeText?: (text: string) => void };
    const box = ({ children }: Props) => element('div', null, children);
    return { View: box, ScrollView: box, Text: ({ children }: Props) => element('span', null, children),
        Pressable: ({ children, onPress, disabled, accessibilityLabel }: Props) => {
            if (accessibilityLabel === 'アカウントを完全に削除する') mocks.deletePress = onPress!;
            return element('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children);
        },
        TextInput: ({ value, onChangeText, accessibilityLabel }: Props) => {
            if (accessibilityLabel === '退会確認文字') mocks.deleteText = onChangeText!;
            return element('input', { value, onChange: (event) => onChangeText?.(event.currentTarget.value), 'aria-label': accessibilityLabel });
        },
        Switch: ({ value, onValueChange, disabled, accessibilityLabel }: { value: boolean; onValueChange: (enabled: boolean) => void; disabled?: boolean; accessibilityLabel?: string }) => {
            mocks.toggle = onValueChange;
            return element('input', { type: 'checkbox', checked: value, disabled, 'aria-label': accessibilityLabel, onChange: (event) => onValueChange(event.target.checked) });
        }, StyleSheet: { create: <T,>(styles: T) => styles } };
});
vi.mock('react-native-safe-area-context', async () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));
vi.mock('expo-router', () => ({ router: { push: vi.fn() }, useFocusEffect: (setup: () => (() => void) | undefined) => {
    useEffect(() => {
        let cleanup = setup(); const blur = () => { cleanup?.(); cleanup = undefined; }; const focus = () => { cleanup = setup(); };
        mocks.blurs.add(blur); mocks.focuses.add(focus); mocks.blur = () => [...mocks.blurs].forEach((callback) => callback()); mocks.focus = () => [...mocks.focuses].forEach((callback) => callback());
        return () => { cleanup?.(); mocks.blurs.delete(blur); mocks.focuses.delete(focus); };
    }, [setup]);
} }));
vi.mock('../components/AppleSignInButton', () => ({ AppleSignInButton: () => null }));
vi.mock('../theme/usePalette', async () => {
    const { LIGHT_THEME } = await import('@life-quest/core/designTokens');
    return { usePalette: () => ({ palette: LIGHT_THEME, resolvedTheme: 'light' }) };
});
vi.mock('../platform/auth', () => ({ getCurrentUser: mocks.user, getPasswordRecoveryState: () => 'idle',
    subscribeAccountDeletionIdentity: (listener: (userId: string | null) => void) => { mocks.identities.add(listener); return () => { mocks.identities.delete(listener); }; },
    subscribePasswordRecoveryState: () => () => undefined,
    deleteCurrentAccount: mocks.remove, cancelPasswordRecovery: vi.fn(), requestPasswordReset: vi.fn(),
    resendEmailVerification: vi.fn(), signInWithEmail: vi.fn(), signInWithApple: vi.fn(), signInWithGoogle: vi.fn(),
    signOutUser: vi.fn(), signUpWithEmail: vi.fn(), updatePasswordFromRecovery: vi.fn() }));
vi.mock('../platform/cloudMigration', () => ({ getPendingMobileContent: mocks.pending, approveMobileContentImport: mocks.approve }));
vi.mock('../platform/supabase', () => ({ readMobileSupabaseEnv: () => ({ url: 'https://example.invalid', anonKey: 'test' }) }));
vi.mock('../platform/notifications', () => ({ ensureNotificationPermission: mocks.permission }));
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue }));
vi.mock('../platform/cloudSync', async () => {
    const { createInactiveCloudSyncState } = await import('@life-quest/core/cloudSyncState');
    return { getMobileCloudSyncState: createInactiveCloudSyncState, subscribeMobileCloudSyncState: () => () => undefined, syncMobileNow: vi.fn() };
});
import SettingsScreen from './SettingsScreen';
import { useMobileSettingsStore } from '../stores/useMobileSettingsStore';

let root: Root;
let container: HTMLDivElement;
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
beforeEach(async () => {
    resetAuthLifecycleHooks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.user.mockReset().mockResolvedValue({ userId: 'a', email: 'a@example.invalid' });
    mocks.pending.mockReset().mockResolvedValue({ tasks: [{ id: 'local' }], habits: [], dailyRecords: [] });
    mocks.approve.mockReset().mockResolvedValue({ status: 'imported' });
    mocks.permission.mockReset().mockResolvedValue(true); mocks.enqueue.mockClear();
    mocks.remove.mockReset().mockResolvedValue({ ok: false, message: 'fixture: 未送信' });
    useMobileSettingsStore.setState({ hasHydrated: true, notificationsEnabled: false });
    await notifyLogin('a');
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});

describe('Mobile退会UIの確認対象と画面寿命', () => {
    const open = () => act(() => button('アカウントを削除する').click());
    const type = (value = '削除') => act(() => mocks.deleteText(value));
    it('SDK切替が共有scopeへ未反映でも古い確認を失効し、旧対象で開き直せない', async () => {
        await render(); open(); type(); const old = mocks.deletePress;
        act(() => mocks.identities.forEach((event) => event('b'))); open();
        expect(container.querySelector('[aria-label="退会確認文字"]')).toBeNull();
        act(() => { mocks.identities.forEach((event) => event('a')); old(); });
        expect(mocks.remove).not.toHaveBeenCalled(); expect(captureAuthSessionScope().userId).toBe('a');
    });
    it('対象を明示し正確な確認文字と連打防止を適用する', async () => {
        let resolve!: (value: AccountDeletionResult) => void;
        mocks.remove.mockReturnValueOnce(new Promise<AccountDeletionResult>((yes) => { resolve = yes; }));
        await render(); open(); expect(container.textContent).toContain('「a@example.invalid」のクラウド');
        type('削除 '); expect(button('アカウントを完全に削除する').disabled).toBe(true); type();
        const old = mocks.deletePress; act(() => { old(); old(); }); expect(mocks.remove).toHaveBeenCalledOnce();
        expect(mocks.remove.mock.calls[0][0].userId).toBe('a');
        await act(async () => resolve({ ok: false, message: '再確認の案内' })); expect(container.textContent).toContain('再確認の案内');
    });
    it.each(['switch', 'logout', 'roundtrip', 'blur', 'cancel', 'unmount'])('%s後の古い確認は送信しない', async (kind) => {
        await render(); open(); type(); const old = mocks.deletePress;
        await act(async () => {
            if (kind === 'switch') { mocks.user.mockResolvedValue({ userId: 'b', email: 'b@example.invalid' }); await notifyLogin('b'); }
            if (kind === 'logout') await notifyLogout();
            if (kind === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); }
            if (kind === 'blur') { mocks.blur(); mocks.focus(); }
            if (kind === 'cancel') button('退会をキャンセルする').click();
            if (kind === 'unmount') root.unmount();
        });
        act(() => old()); expect(mocks.remove).not.toHaveBeenCalled();
    });
    it('自分の退会によるログアウト後に片付け失敗の案内も表示する', async () => {
        mocks.remove.mockImplementationOnce(async () => {
            mocks.user.mockResolvedValue(null); await notifyLogout();
            return { ok: false, message: 'アカウントは削除されました。アプリを再起動してください。', completionScope: captureAuthSessionScope().isCurrent };
        });
        await render(); open(); type(); await act(async () => mocks.deletePress());
        expect(container.textContent).toContain('アカウントは削除されました。アプリを再起動');
        expect(container.querySelector('[aria-label="退会確認文字"]')).toBeNull();
    });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(createElement(SettingsScreen)));

function deferred() { let resolve!: (granted: boolean) => void; let reject!: () => void; const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = () => no(new Error('fixture')); }); return { promise, resolve, reject }; }
const notificationSwitch = () => container.querySelector<HTMLInputElement>('[aria-label="習慣リマインダー通知"]')!;
describe('Mobile notification permission ownership', () => {
    it('StrictModeでも通常の許可・時刻・OFF操作を維持する', async () => {
        await act(async () => root.render(createElement(StrictMode, {}, createElement(SettingsScreen))));
        await act(async () => mocks.toggle(true)); expect(useMobileSettingsStore.getState().notificationsEnabled).toBe(true);
        await act(async () => button('通知時刻を22時にする').click()); expect(useMobileSettingsStore.getState().habitReminderHour).toBe(22);
        await act(async () => mocks.toggle(false)); expect(useMobileSettingsStore.getState().notificationsEnabled).toBe(false);
    });
    it('許可待ちにOFFを選んだら、古い許可結果で再びONにしない', async () => {
        const wait = deferred(); mocks.permission.mockReturnValueOnce(wait.promise); await render();
        act(() => { mocks.toggle(true); mocks.toggle(true); }); expect(mocks.permission).toHaveBeenCalledOnce(); expect(notificationSwitch().checked).toBe(true);
        act(() => mocks.toggle(false)); await act(async () => wait.resolve(true));
        expect(useMobileSettingsStore.getState().notificationsEnabled).toBe(false); expect(notificationSwitch().checked).toBe(false); expect(mocks.enqueue).not.toHaveBeenCalled();
    });
    it.each(['switch', 'logout', 'roundtrip', 'blur'])('%s後に戻っても古い許可を反映しない', async (kind) => {
        const wait = deferred(); mocks.permission.mockReturnValueOnce(wait.promise); await render(); const old = mocks.toggle;
        act(() => mocks.toggle(true));
        await act(async () => {
            if (kind === 'switch') await notifyLogin('b'); if (kind === 'logout') await notifyLogout();
            if (kind === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); }
            if (kind === 'blur') { mocks.blur(); mocks.focus(); }
            wait.resolve(true);
        });
        act(() => old(true)); expect(useMobileSettingsStore.getState().notificationsEnabled).toBe(false);
        expect(mocks.permission).toHaveBeenCalledOnce(); expect(notificationSwitch().checked).toBe(false);
    });
    it('アンマウント後に許可を反映しない', async () => {
        const wait = deferred(); mocks.permission.mockReturnValueOnce(wait.promise); await render(); act(() => mocks.toggle(true));
        await act(async () => { root.unmount(); wait.resolve(true); }); expect(useMobileSettingsStore.getState().notificationsEnabled).toBe(false);
    });
    it('古い拒否・finallyで新しい許可待ちの表示を消さない', async () => {
        const old = deferred(); const current = deferred(); mocks.permission.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise); await render();
        act(() => mocks.toggle(true)); act(() => mocks.toggle(false)); act(() => mocks.toggle(true));
        await act(async () => old.resolve(false)); expect(notificationSwitch().checked).toBe(true); expect(container.textContent).not.toContain('通知が許可されていません');
        await act(async () => current.resolve(true)); expect(useMobileSettingsStore.getState().notificationsEnabled).toBe(true);
    });
    it('同一ユーザー通知と同値pullでは許可待ちを維持する', async () => {
        const wait = deferred(); mocks.permission.mockReturnValueOnce(wait.promise); await render(); act(() => mocks.toggle(true));
        await act(async () => { await notifyLogin('a'); useMobileSettingsStore.setState({ notificationsEnabled: false }); wait.resolve(true); });
        expect(useMobileSettingsStore.getState().notificationsEnabled).toBe(true);
    });
    it('同期で設定がON→OFFになった場合は古い許可を反映しない', async () => {
        const wait = deferred(); mocks.permission.mockReturnValueOnce(wait.promise); await render(); act(() => mocks.toggle(true));
        await act(async () => { useMobileSettingsStore.setState({ notificationsEnabled: true }); useMobileSettingsStore.setState({ notificationsEnabled: false }); wait.resolve(true); });
        expect(useMobileSettingsStore.getState().notificationsEnabled).toBe(false);
    });
    it('復元前は要求せず、要求失敗は再試行できる', async () => {
        useMobileSettingsStore.setState({ hasHydrated: false }); await render(); act(() => mocks.toggle(true)); expect(mocks.permission).not.toHaveBeenCalled();
        await act(async () => useMobileSettingsStore.setState({ hasHydrated: true })); mocks.permission.mockRejectedValueOnce(new Error('fixture'));
        await act(async () => mocks.toggle(true)); expect(notificationSwitch().checked).toBe(false); expect(container.textContent).toContain('通知が許可されていません');
        await act(async () => mocks.toggle(true)); expect(useMobileSettingsStore.getState().notificationsEnabled).toBe(true);
    });
});

describe('Mobile SettingsScreenの統合UI（native部品はDOMスタブ）', () => {
    it('候補を消したあとも統合完了メッセージを表示する', async () => {
        await render();
        await act(async () => button('この端末のデータをクラウドへ統合する').click());
        expect(container.textContent).toContain('この端末のデータをクラウドへ統合しました');
        expect(button('この端末のデータをクラウドへ統合する')).toBeNull();
        expect(mocks.approve).toHaveBeenCalledOnce();
    });

    it('確認エラーの再確認ボタンから候補を取得し直せる', async () => {
        mocks.pending.mockRejectedValueOnce(new Error('storage failed'));
        await render();
        expect(container.textContent).toContain('端末データの確認に失敗');
        await act(async () => button('統合候補を再確認する').click());
        expect(button('この端末のデータをクラウドへ統合する')).not.toBeNull();
        expect(mocks.pending).toHaveBeenCalledTimes(2);
        expect(mocks.approve).not.toHaveBeenCalled();
    });

    it('アカウント確認自体のエラーも隠さず再確認できる', async () => {
        mocks.user.mockRejectedValueOnce(new Error('session unavailable'));
        await render();
        expect(container.textContent).toContain('端末データの確認に失敗');
        await act(async () => button('統合候補を再確認する').click());
        expect(container.textContent).toContain('a@example.invalid');
    });

    it('別アカウント切替時に前の退会確認欄も破棄する', async () => {
        await render();
        await act(async () => button('アカウントを削除する').click());
        expect(container.querySelector('input[aria-label="退会確認文字"]')).not.toBeNull();
        mocks.user.mockResolvedValue({ userId: 'b', email: 'b@example.invalid' });
        await act(async () => { await notifyLogin('b'); });
        expect(container.querySelector('input[aria-label="退会確認文字"]')).toBeNull();
        expect(container.textContent).not.toContain('a@example.invalid');
        expect(container.textContent).toContain('b@example.invalid');
    });
});
