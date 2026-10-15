import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';

const mocks = vi.hoisted(() => ({ user: vi.fn(), pending: vi.fn(), approve: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined), getAllKeys: vi.fn(async () => []),
} }));
vi.mock('react-native', async () => {
    const { createElement: element } = await import('react');
    type Props = { children?: ReactNode; accessibilityLabel?: string; accessibilityRole?: string;
        onPress?: () => void; disabled?: boolean; value?: string; onChangeText?: (text: string) => void };
    const box = ({ children }: Props) => element('div', null, children);
    return { View: box, ScrollView: box, Text: ({ children }: Props) => element('span', null, children),
        Pressable: ({ children, onPress, disabled, accessibilityLabel }: Props) => element('button',
            { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
        TextInput: ({ value, onChangeText, accessibilityLabel }: Props) => element('input',
            { value, onChange: (event) => onChangeText?.(event.currentTarget.value), 'aria-label': accessibilityLabel }),
        Switch: () => element('input', { type: 'checkbox' }), StyleSheet: { create: <T,>(styles: T) => styles } };
});
vi.mock('react-native-safe-area-context', async () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('../components/AppleSignInButton', () => ({ AppleSignInButton: () => null }));
vi.mock('../theme/usePalette', async () => {
    const { LIGHT_THEME } = await import('@life-quest/core/designTokens');
    return { usePalette: () => ({ palette: LIGHT_THEME, resolvedTheme: 'light' }) };
});
vi.mock('../platform/auth', () => ({ getCurrentUser: mocks.user, getPasswordRecoveryState: () => 'idle',
    subscribePasswordRecoveryState: () => () => undefined,
    deleteCurrentAccount: vi.fn(), cancelPasswordRecovery: vi.fn(), requestPasswordReset: vi.fn(),
    resendEmailVerification: vi.fn(), signInWithEmail: vi.fn(), signInWithApple: vi.fn(), signInWithGoogle: vi.fn(),
    signOutUser: vi.fn(), signUpWithEmail: vi.fn(), updatePasswordFromRecovery: vi.fn() }));
vi.mock('../platform/cloudMigration', () => ({ getPendingMobileContent: mocks.pending, approveMobileContentImport: mocks.approve }));
vi.mock('../platform/supabase', () => ({ readMobileSupabaseEnv: () => ({ url: 'https://example.invalid', anonKey: 'test' }) }));
vi.mock('../platform/notifications', () => ({ ensureNotificationPermission: vi.fn() }));
vi.mock('../platform/cloudSync', async () => {
    const { createInactiveCloudSyncState } = await import('@life-quest/core/cloudSyncState');
    return { getMobileCloudSyncState: createInactiveCloudSyncState, subscribeMobileCloudSyncState: () => () => undefined, syncMobileNow: vi.fn() };
});
import SettingsScreen from './SettingsScreen';

let root: Root;
let container: HTMLDivElement;
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
beforeEach(async () => {
    resetAuthLifecycleHooks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.user.mockReset().mockResolvedValue({ userId: 'a', email: 'a@example.invalid' });
    mocks.pending.mockReset().mockResolvedValue({ tasks: [{ id: 'local' }], habits: [], dailyRecords: [] });
    mocks.approve.mockReset().mockResolvedValue({ status: 'imported' });
    await notifyLogin('a');
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(createElement(SettingsScreen)));

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
