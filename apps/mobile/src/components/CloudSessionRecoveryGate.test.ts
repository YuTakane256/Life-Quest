import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import { CloudSessionRecoveryGate } from './CloudSessionRecoveryGate';
import { getSecureSessionStorageState, retrySecureSessionStorage, secureStoreSessionAdapter } from '../platform/secureSessionStorage';

const recovery = vi.hoisted(() => ({ state: 'ready', theme: 'light' as 'light' | 'dark' }));
vi.mock('../platform/auth', () => ({
    subscribePasswordRecoveryState: () => () => {}, getPasswordRecoveryState: () => 'idle',
}));
vi.mock('../platform/cloudSessionRecovery', () => ({
    subscribeMobileCloudRecovery: () => () => {}, getMobileCloudRecoveryState: () => recovery.state,
}));
vi.mock('../screens/SettingsScreen', () => ({ default: () => createElement('div', {}, 'アカウントの復旧') }));
vi.mock('../theme/usePalette', async () => {
    const { getMobileThemePalette } = await import('../theme/colors');
    return { usePalette: () => ({ palette: getMobileThemePalette(recovery.theme) }) };
});
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock('react-native', async () => {
    const { createElement } = await import('react');
    type Props = { children?: ReactNode; visible?: boolean; accessibilityLabel?: string; onPress?: () => void;
        onRequestClose?: () => void };
    const box = ({ children }: Props) => createElement('div', {}, children);
    return {
        View: box, ScrollView: box, Text: box, ActivityIndicator: () => createElement('div', { role: 'progressbar' }),
        StyleSheet: { create: <T>(value: T) => value },
        Modal: ({ visible, children, onRequestClose }: Props) => visible ? createElement('div', { role: 'dialog' },
            createElement('button', { 'aria-label': 'OS back', onClick: onRequestClose }), children) : null,
        Pressable: ({ children, accessibilityLabel, onPress }: Props) => createElement('button', {
            'aria-label': accessibilityLabel, onClick: onPress,
        }, children),
    };
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    recovery.state = 'ready'; recovery.theme = 'light';
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
    await act(async () => {
        vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
        retrySecureSessionStorage();
        root.unmount();
    });
    host.remove(); vi.resetAllMocks(); vi.unstubAllGlobals();
});

it.each(['light', 'dark'] as const)('read failure blocks a ready cloud UI and supports explicit retry in %s mode', async (theme) => {
    recovery.theme = theme;
    vi.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('private-keychain-detail'));
    let session!: Promise<string | null>;
    await act(async () => {
        root.render(createElement(CloudSessionRecoveryGate));
        session = secureStoreSessionAdapter.getItem('session');
    });
    expect(host.textContent).toContain('ログイン情報を確認できません');
    expect(host.textContent).toContain('保存データを保持しています');
    expect(host.textContent).not.toContain('private-keychain-detail');
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="OS back"]')!.click());
    expect(getSecureSessionStorageState()).toBe('blocked');

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="ログイン情報を再確認する"]')!.click());
    expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('再確認する');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();

    let finish!: (value: string) => void;
    vi.mocked(SecureStore.getItemAsync).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="ログイン情報を再確認する"]')!.click());
    expect(host.textContent).toContain('ログイン情報を再確認しています');
    expect(host.querySelector('[aria-label="ログイン情報を再確認する"]')).toBeNull();
    await act(async () => { finish('saved-session'); await session; });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('returns to the existing account check or recovery UI after a successful storage retry', async () => {
    recovery.state = 'checking';
    await act(async () => root.render(createElement(CloudSessionRecoveryGate)));
    expect(host.textContent).toContain('アカウントを確認しています');
    vi.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('locked'));
    let session!: Promise<string | null>;
    await act(async () => { session = secureStoreSessionAdapter.getItem('session'); });
    expect(host.textContent).toContain('ログイン情報を確認できません');
    recovery.state = 'required';
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
    await act(async () => { retrySecureSessionStorage(); await session; });
    expect(host.textContent).toContain('アカウントの復旧');
    expect(host.textContent).not.toContain('ログイン情報を確認できません');
});
