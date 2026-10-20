import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { NotificationSettings } from './NotificationSettings';
import { useNotificationStore } from '../../stores/useNotificationStore';

const mocks = vi.hoisted(() => ({ request: vi.fn(), sync: vi.fn(), toggle: () => {},
    capture: (value: unknown) => { const props = value as Record<string, unknown> | null; if (props?.['aria-label'] === '通知のON/OFF') mocks.toggle = props.onClick as () => void; },
}));
vi.mock('../../platform/settingsSync', () => ({ syncSettingsToCloud: mocks.sync }));
vi.mock('react/jsx-runtime', async (original) => { const module = await original<typeof import('react/jsx-runtime')>(); return { ...module,
    jsx: (...args: Parameters<typeof module.jsx>) => { mocks.capture(args[1]); return module.jsx(...args); }, jsxs: (...args: Parameters<typeof module.jsxs>) => { mocks.capture(args[1]); return module.jsxs(...args); },
}; });
vi.mock('react/jsx-dev-runtime', async (original) => { const module = await original<typeof import('react/jsx-dev-runtime')>(); return { ...module,
    jsxDEV: (...args: Parameters<typeof module.jsxDEV>) => { mocks.capture(args[1]); return module.jsxDEV(...args); },
}; });
class NotificationStub { static permission: NotificationPermission = 'default'; static requestPermission = mocks.request; }
let root: Root; let host: HTMLDivElement;
function deferred() { let resolve!: (value: NotificationPermission) => void; const promise = new Promise<NotificationPermission>((yes) => { resolve = yes; }); return { promise, resolve }; }
const toggle = () => host.querySelector<HTMLButtonElement>('[role="switch"]')!;
const render = () => act(() => root.render(createElement(StrictMode, {}, createElement(NotificationSettings))));
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('Notification', NotificationStub);
    NotificationStub.permission = 'default'; mocks.request.mockReset().mockResolvedValue('granted'); mocks.sync.mockClear();
    useNotificationStore.setState({ enabled: false, notifiedTaskIds: [], lastHabitReminderDate: null, habitReminderHour: 20 });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals(); });
describe('Web notification permission ownership', () => {
    it('通常の許可・時刻・OFF操作を維持する', async () => {
        render(); await act(async () => toggle().click()); expect(useNotificationStore.getState().enabled).toBe(true);
        const hour = host.querySelector<HTMLSelectElement>('select')!;
        act(() => { hour.value = '22'; hour.dispatchEvent(new Event('change', { bubbles: true })); }); expect(useNotificationStore.getState().habitReminderHour).toBe(22);
        act(() => toggle().click()); expect(useNotificationStore.getState().enabled).toBe(false);
    });
    it('連打で複数要求せず、待機中のOFF後に古い許可を反映しない', async () => {
        const wait = deferred(); mocks.request.mockReturnValueOnce(wait.promise); render(); const old = mocks.toggle;
        act(() => { old(); old(); }); expect(mocks.request).toHaveBeenCalledOnce(); expect(toggle().getAttribute('aria-checked')).toBe('true');
        act(() => toggle().click()); await act(async () => wait.resolve('granted'));
        expect(useNotificationStore.getState().enabled).toBe(false); expect(toggle().getAttribute('aria-busy')).toBe('false'); expect(mocks.sync).not.toHaveBeenCalled();
    });
    it.each(['switch', 'logout', 'roundtrip', 'unmount'])('%s後に古い許可を反映しない', async (kind) => {
        const wait = deferred(); mocks.request.mockReturnValueOnce(wait.promise); render(); const old = mocks.toggle; act(() => { old(); });
        await act(async () => {
            if (kind === 'switch') await notifyLogin('b'); if (kind === 'logout') await notifyLogout();
            if (kind === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); } if (kind === 'unmount') root.unmount();
            wait.resolve('granted');
        }); act(() => { old(); }); expect(useNotificationStore.getState().enabled).toBe(false); expect(mocks.request).toHaveBeenCalledOnce();
    });
    it('古い拒否で新しい許可待ちを終了しない', async () => {
        const old = deferred(); const current = deferred(); mocks.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise); render();
        act(() => toggle().click()); act(() => toggle().click()); act(() => toggle().click()); await act(async () => old.resolve('denied'));
        expect(toggle().getAttribute('aria-busy')).toBe('true'); expect(host.textContent).not.toContain('通知がブロックされています');
        await act(async () => current.resolve('granted')); expect(useNotificationStore.getState().enabled).toBe(true);
    });
    it('同一ユーザー通知・同値pullでは待機を維持する', async () => {
        const wait = deferred(); mocks.request.mockReturnValueOnce(wait.promise); render(); act(() => toggle().click());
        await act(async () => { await notifyLogin('a'); useNotificationStore.setState({ enabled: false }); wait.resolve('granted'); }); expect(useNotificationStore.getState().enabled).toBe(true);
    });
    it('同期でON→OFFになった場合は古い許可を反映しない', async () => {
        const wait = deferred(); mocks.request.mockReturnValueOnce(wait.promise); render(); act(() => toggle().click());
        await act(async () => { useNotificationStore.setState({ enabled: true }); useNotificationStore.setState({ enabled: false }); wait.resolve('granted'); }); expect(useNotificationStore.getState().enabled).toBe(false);
    });
    it('OS側で拒否済みでもアプリのON設定はOFFに戻せる', () => {
        NotificationStub.permission = 'denied'; useNotificationStore.setState({ enabled: true }); render(); expect(toggle().disabled).toBe(false);
        act(() => toggle().click()); expect(useNotificationStore.getState().enabled).toBe(false); expect(toggle().disabled).toBe(true);
    });
});
