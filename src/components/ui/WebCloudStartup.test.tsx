import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';

const recovery = vi.hoisted(() => ({
    state: 'idle' as 'idle' | 'ready' | 'invalid',
    listeners: new Set<() => void>(),
}));

vi.mock('../../platform/auth', () => ({
    getPasswordRecoveryState: () => recovery.state,
    subscribePasswordRecoveryState: (listener: () => void) => {
        recovery.listeners.add(listener);
        return () => recovery.listeners.delete(listener);
    },
}));

vi.mock('./AccountSettings', () => ({ AccountSettings: () => <div>アカウントフォーム</div> }));

vi.mock('./ThemeController', () => ({ ThemeController: () => null }));

import { WebCloudStartup } from './WebCloudStartup';
import { useGameStore } from '../../stores/useGameStore';
import { withoutCompletionRewardPersistence } from '../../platform/completionRewards';

let host: HTMLDivElement;
let root: Root;

function render(hasSavedCloudDisplay: boolean) {
    act(() => root.render(
        <StrictMode>
            <WebCloudStartup hasSavedCloudDisplay={hasSavedCloudDisplay}>
                <div>タスク画面</div>
            </WebCloudStartup>
        </StrictMode>,
    ));
}

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    setGameRewardAuthorityState('resolving');
    recovery.state = 'idle';
    window.history.replaceState(null, '', '/tasks');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    withoutCompletionRewardPersistence(() => useGameStore.setState({ completionRewardError: null }));
    vi.unstubAllGlobals();
});

it('クラウド表示を持たない起動では、認証の完了前に画面を表示できる', () => {
    render(false);
    expect(host.textContent).toContain('タスク画面');
    expect(host.querySelector('[role="status"]')).toBeNull();
});

it.each(['anonymous', 'authenticated'] as const)(
    '保存クラウド表示がある起動は %s への確定を待ち、以後の認証状態変化では画面を再び覆わない',
    (authority) => {
        render(true);
        expect(host.textContent).not.toContain('タスク画面');
        expect(host.querySelector('[role="status"]')?.textContent).toContain('保存データを確認しています');
        act(() => setGameRewardAuthorityState(authority));
        expect(host.textContent).toContain('タスク画面');
        act(() => setGameRewardAuthorityState('resolving'));
        expect(host.textContent).toContain('タスク画面');
    },
);

it('保存データの退避に失敗した場合は画面を覆ったまま再読み込みを案内する', () => {
    render(true);
    act(() => withoutCompletionRewardPersistence(() => useGameStore.setState({ completionRewardError: '保存エラー' })));
    expect(host.textContent).not.toContain('タスク画面');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('保存データを確認できませんでした');
    expect(host.querySelector('button')?.textContent).toBe('再読み込み');
});

it.each(['ready', 'invalid'] as const)('パスワード再設定が %s の間はアカウントフォームだけを表示する', (state) => {
    render(true);
    act(() => {
        recovery.state = state;
        recovery.listeners.forEach((listener) => listener());
    });
    expect(host.textContent).toContain('アカウントフォーム');
    expect(host.textContent).not.toContain('タスク画面');
    act(() => {
        recovery.state = 'idle';
        recovery.listeners.forEach((listener) => listener());
        setGameRewardAuthorityState('anonymous');
    });
    expect(host.textContent).toContain('タスク画面');
    expect(host.textContent).not.toContain('アカウントフォーム');
});
