import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createTask, type Task } from '@life-quest/core/tasks';
import { useTaskStore } from '../stores/useTaskStore';
import { useMobileTaskStore } from '../../apps/mobile/src/stores/useMobileTaskStore';
import { TasksPage } from '../pages/TasksPage';

const mocks = vi.hoisted(() => ({ alert: vi.fn(), enqueue: vi.fn(async () => true), confirm: () => {}, cancel: () => {}, blur: () => {}, focus: () => {}, focusEffects: new Set<() => void>(), blurEffects: new Set<() => void>() }));
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isWebCloudOutboxActive: () => false }));
vi.mock('../../apps/mobile/src/platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isCloudOutboxActive: () => false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../components/ui/snackbarContext', () => ({ useSnackbar: () => ({ showUndo: vi.fn() }) }));
vi.mock('../../apps/mobile/src/hooks/useTaskUndoToast', () => ({ useTaskUndoToast: () => ({ toast: null, showUndo: vi.fn() }) }));
vi.mock('../../apps/mobile/src/components/TaskBottomActions', () => ({ TaskBottomActions: () => null }));
vi.mock('../../apps/mobile/src/theme/usePalette', async () => {
    const { DARK_THEME } = await import('@life-quest/core/designTokens'); return { usePalette: () => ({ palette: DARK_THEME }) };
});
vi.mock('../components/ui/ConfirmDialog', async (original) => {
    const { ConfirmDialog } = await original<typeof import('../components/ui/ConfirmDialog')>();
    return { ConfirmDialog: (props: Parameters<typeof ConfirmDialog>[0]) => {
        if (props.open) { mocks.confirm = props.onConfirm; mocks.cancel = props.onClose; }
        return createElement(ConfirmDialog, props);
    } };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }), useFocusEffect: (setup: () => (() => void) | undefined) => {
    useEffect(() => {
        let cleanup = setup(); const blur = () => { cleanup?.(); cleanup = undefined; }; const focus = () => { cleanup = setup(); };
        mocks.blurEffects.add(blur); mocks.focusEffects.add(focus);
        mocks.blur = () => { for (const callback of mocks.blurEffects) callback(); }; mocks.focus = () => { for (const callback of mocks.focusEffects) callback(); };
        return () => { cleanup?.(); mocks.blurEffects.delete(blur); mocks.focusEffects.delete(focus); };
    }, [setup]);
} }));
vi.mock('lucide-react-native', () => import('lucide-react'));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children?: ReactNode }) => createElement('div', {}, children) }));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string };
    const box = ({ children }: Props) => createElement('div', {}, children);
    return { AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) }, Alert: { alert: mocks.alert }, View: box, ScrollView: box, KeyboardAvoidingView: box,
        Text: ({ children }: Props) => createElement('span', {}, children), TextInput: () => null,
        Pressable: ({ children, onPress, disabled, accessibilityLabel }: Props) => createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
        FlatList: ({ ListHeaderComponent }: { ListHeaderComponent?: ReactNode }) => createElement('div', {}, ListHeaderComponent),
        Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove: vi.fn() }) }, Platform: { OS: 'ios' }, Share: { share: vi.fn(async () => {}) },
        StyleSheet: { create: <T,>(value: T) => value }, Modal: () => null,
    };
});
// Keep the Native static-image declaration program separate from Web type checking.
const nativeModule = '../../apps/mobile/src/screens/TasksScreen';
const { default: TasksScreen } = await import(nativeModule);
let host: HTMLDivElement; let root: Root | null;
function task(id: string, completed = true): Task {
    return { ...createTask({ id, name: id, now: '2026-10-19T00:00:00.000Z' })!, completed,
        completedAt: completed ? '2026-10-19T01:00:00.000Z' : null };
}
function unmount() { if (root) act(() => { root!.unmount(); root = null; }); }
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
    useTaskStore.setState({ tasks: [task('one'), task('two'), task('open', false)], pendingCompletions: [] });
    useMobileTaskStore.setState({ tasks: [task('one'), task('two'), task('open', false)], pendingCompletions: [], hasHydrated: true });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { unmount(); host.remove(); resetAuthLifecycleHooks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

for (const platform of ['web', 'native'] as const) {
    const store = platform === 'web' ? useTaskStore : useMobileTaskStore;
    const setTasks = (tasks: Task[]) => { if (platform === 'web') useTaskStore.setState({ tasks }); else useMobileTaskStore.setState({ tasks }); };
    const setPending = (id: string) => {
        if (platform === 'web') useTaskStore.setState({ pendingCompletions: [{ taskId: id, timeoutId: window.setTimeout(() => {}, 60000), completedAt: task(id).completedAt! }] });
        else useMobileTaskStore.setState({ pendingCompletions: [{ taskId: id, timeoutId: setTimeout(() => {}, 60000), completedAt: task(id).completedAt! }] });
    };
    function mount() { act(() => root!.render(createElement(StrictMode, {}, createElement(MemoryRouter, {},
        platform === 'web' ? createElement(TasksPage) : createElement(TasksScreen))))); }
    function request() {
        const button = Array.from(host.querySelectorAll('button')).find((item) => /完了.*件.*削除/.test(item.textContent ?? ''))!;
        expect(button).toBeTruthy(); act(() => button.click());
        if (platform === 'web') return { confirm: mocks.confirm, cancel: mocks.cancel };
        const actions = mocks.alert.mock.calls.at(-1)![2];
        return { confirm: actions.find((item: { text: string }) => item.text === '削除する').onPress as () => void,
            cancel: actions.find((item: { text: string }) => item.text === 'キャンセル').onPress as () => void };
    }
    describe(`${platform}: completed bulk deletion`, () => {
        it('通常確定は承認2件だけを削除・enqueueし、二度確定しても再実行しない', () => {
            mount(); const { confirm } = request(); act(confirm);
            expect(store.getState().tasks.map((item) => item.id)).toEqual(['open']);
            expect(mocks.enqueue.mock.calls).toEqual(['one', 'two'].map((id) => ['delete_task', { p_id: id }, { dependsOnEntityIds: [id] }]));
            act(() => { setTasks([task('one'), task('two')]); confirm(); });
            expect(store.getState().tasks).toHaveLength(2); expect(mocks.enqueue).toHaveBeenCalledTimes(2);
        });
        it('確認後の新しい完了を削除せず、確認件数も増やさない', () => {
            mount(); const { confirm } = request();
            act(() => setTasks([task('one'), task('two'), task('open')]));
            if (platform === 'web') expect(host.querySelector('[role="dialog"]')?.textContent).toContain('タスク2件');
            act(confirm); expect(store.getState().tasks.map((item) => item.id)).toEqual(['open']);
            expect(mocks.enqueue).not.toHaveBeenCalledWith('delete_task', { p_id: 'open' }, expect.anything());
        });
        it.each(['edited', 'reopened', 'pending', 'subtask', 'replaced'] as const)('%sとなった対象を残し、未変更のもう1件だけ削除する', (change) => {
            mount(); const { confirm } = request();
            act(() => {
                const one = task('one');
                if (change === 'edited') one.name = 'edited';
                if (change === 'reopened') { one.completed = false; one.completedAt = null; }
                if (change === 'subtask') one.subtasks = [{ id: 'sub', name: 'new', completed: false, completedAt: null, createdAt: one.createdAt }];
                if (change === 'replaced') one.createdAt = '2026-10-20T00:00:00.000Z';
                setTasks([one, task('two')]); if (change === 'pending') setPending('one'); confirm();
            });
            expect(store.getState().tasks.map((item) => item.id)).toEqual(['one']);
            if (change === 'pending') expect(store.getState().pendingCompletions.map((item) => item.taskId)).toEqual(['one']);
            expect(mocks.enqueue).toHaveBeenCalledOnce(); expect(mocks.enqueue).toHaveBeenCalledWith('delete_task', { p_id: 'two' }, { dependsOnEntityIds: ['two'] });
        });
        it.each(['switch', 'logout', 'roundtrip', 'unmount'] as const)('%s後の旧callbackで現在の同IDタスクを削除しない', async (transition) => {
            mount(); const { confirm } = request();
            await act(async () => {
                if (transition === 'switch') await notifyLogin('b');
                if (transition === 'logout') await notifyLogout();
                if (transition === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); }
                if (transition === 'unmount') unmount();
                setTasks([task('one'), task('two')]); confirm();
            });
            expect(store.getState().tasks).toHaveLength(2); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('同じユーザー通知と同値pullは通常確定できる', async () => {
            mount(); const { confirm } = request();
            await act(async () => { await notifyLogin('a'); setTasks([task('one'), task('two')]); confirm(); });
            expect(store.getState().tasks).toHaveLength(0); expect(mocks.enqueue).toHaveBeenCalledTimes(2);
        });
        it('再描画前の切替でも旧画面から確認を開かない', async () => {
            mount(); const button = Array.from(host.querySelectorAll('button')).find((item) => /完了.*件.*削除/.test(item.textContent ?? ''))!;
            await act(async () => { await notifyLogin('b'); button.click(); });
            expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(mocks.alert).not.toHaveBeenCalled();
        });
        it('キャンセル後の旧callbackは実行できない', () => {
            mount(); const { confirm, cancel } = request(); act(() => { cancel(); confirm(); });
            expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('後から開いた確認を古い確認/取消で消さない', () => {
            mount(); const old = request(); const latest = request();
            act(() => { old.confirm(); old.cancel(); }); expect(mocks.enqueue).not.toHaveBeenCalled();
            act(latest.confirm); expect(mocks.enqueue).toHaveBeenCalledTimes(2);
        });
        it('未承認IDと空配列はストア側でも削除しない', () => {
            store.getState().deleteCompletedTasks([]); expect(store.getState().tasks).toHaveLength(3);
            store.getState().deleteCompletedTasks(['one']); expect(store.getState().tasks.map((item) => item.id)).toEqual(['two', 'open']);
            expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        if (platform === 'native') it('タブへ戻っても以前のAlertは無効のまま', () => {
            mount(); const { confirm } = request(); act(() => { mocks.blur(); mocks.focus(); confirm(); });
            expect(mocks.enqueue).not.toHaveBeenCalled();
            const next = request(); act(next.confirm); expect(mocks.enqueue).toHaveBeenCalledTimes(2);
        });
    });
}
