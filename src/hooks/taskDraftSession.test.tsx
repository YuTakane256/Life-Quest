import { act, createElement, StrictMode, useEffect, type FormEvent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createTask, type Task } from '@life-quest/core/tasks';
import { useTaskStore } from '../stores/useTaskStore';
import { useMobileTaskStore } from '../../apps/mobile/src/stores/useMobileTaskStore';
import { TasksPage } from '../pages/TasksPage';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(async () => true),
    webSubmit: (() => {}) as (event: FormEvent) => void, nativeSubmit: () => {}, cancel: () => {},
    webChange: (_value: string) => {}, focusEffects: new Set<() => void>(), blurEffects: new Set<() => void>(),
}));
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isWebCloudOutboxActive: () => false }));
vi.mock('../../apps/mobile/src/platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isCloudOutboxActive: () => false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../components/ui/snackbarContext', () => ({ useSnackbar: () => ({ showUndo: vi.fn() }) }));
vi.mock('../../apps/mobile/src/hooks/useTaskUndoToast', () => ({ useTaskUndoToast: () => ({ toast: null, showUndo: vi.fn() }) }));
vi.mock('../../apps/mobile/src/components/TaskBottomActions', () => ({ TaskBottomActions: ({ onToggleForm }: { onToggleForm: () => void }) =>
    createElement('button', { 'aria-label': '新しいタスクを追加', onClick: onToggleForm }, '追加フォーム') }));
vi.mock('../../apps/mobile/src/theme/usePalette', async () => {
    const { DARK_THEME } = await import('@life-quest/core/designTokens'); return { usePalette: () => ({ palette: DARK_THEME }) };
});
vi.mock('../components/tasks/TaskForm', async (original) => {
    const { TaskForm } = await original<typeof import('../components/tasks/TaskForm')>();
    return { TaskForm: (props: Parameters<typeof TaskForm>[0]) => {
        mocks.webSubmit = props.onSubmit; mocks.cancel = props.onCancel; mocks.webChange = props.onNameChange;
        return createElement(TaskForm, props);
    } };
});
vi.mock('../../apps/mobile/src/components/DailyScreenUI', async (original) => {
    const module = await original<typeof import('../../apps/mobile/src/components/DailyScreenUI')>();
    return { ...module, FormActions: (props: Parameters<typeof module.FormActions>[0]) => {
        mocks.nativeSubmit = props.onSave; mocks.cancel = props.onCancel;
        return createElement(module.FormActions, props);
    } };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }), useFocusEffect: (setup: () => (() => void) | undefined) => {
    useEffect(() => {
        let cleanup = setup();
        const blur = () => { cleanup?.(); cleanup = undefined; };
        const focus = () => { cleanup = setup(); };
        mocks.blurEffects.add(blur); mocks.focusEffects.add(focus);
        return () => { cleanup?.(); mocks.blurEffects.delete(blur); mocks.focusEffects.delete(focus); };
    }, [setup]);
} }));
vi.mock('lucide-react-native', () => import('lucide-react'));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children?: ReactNode }) => createElement('div', {}, children) }));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string };
    const box = ({ children }: Props) => createElement('div', {}, children);
    return { AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) }, Alert: { alert: vi.fn() }, View: box, ScrollView: box, KeyboardAvoidingView: box, Modal: box,
        Text: ({ children }: Props) => createElement('span', {}, children),
        TextInput: ({ value, accessibilityLabel, placeholder, onChangeText }: { value?: string; accessibilityLabel?: string; placeholder?: string; onChangeText?: (value: string) => void }) =>
            createElement('input', { value, placeholder, 'aria-label': accessibilityLabel, onChange: (event) => onChangeText?.(event.target.value) }),
        Pressable: ({ children, onPress, disabled, accessibilityLabel }: Props) => createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
        FlatList: ({ ListHeaderComponent, data, renderItem }: { ListHeaderComponent: ReactNode; data: Task[]; renderItem: (value: { item: Task }) => ReactNode }) =>
            createElement('div', {}, createElement('div', { key: 'header' }, ListHeaderComponent), data.map((item) => createElement('div', { key: item.id }, renderItem({ item })))),
        Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove: vi.fn() }) }, Platform: { OS: 'ios' }, Share: { share: vi.fn(async () => {}) },
        StyleSheet: { create: <T,>(value: T) => value },
    };
});
// Native image declarations belong to its own TypeScript program.
const nativeModule = '../../apps/mobile/src/screens/TasksScreen';
const { default: TasksScreen } = await import(nativeModule);
let host: HTMLDivElement; let root: Root | null;
const task = (): Task => createTask({ id: 'one', name: '編集対象', recurrence: 'daily', now: '2026-10-19T00:00:00Z' })!;
function unmount() { if (root) act(() => { root!.unmount(); root = null; }); }
function press(label: string) {
    const button = [...host.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent === label);
    expect(button, label).toBeDefined(); act(() => button!.click());
}
function input(value: string) {
    const field = host.querySelector<HTMLInputElement>('[placeholder="タスク名を入力..."]')!;
    expect(field).toBeTruthy();
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
    useTaskStore.setState({ tasks: [task()], pendingCompletions: [] });
    useMobileTaskStore.setState({ tasks: [task()], pendingCompletions: [], hasHydrated: true });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { unmount(); host.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals(); });

for (const platform of ['web', 'native'] as const) {
    const store = platform === 'web' ? useTaskStore : useMobileTaskStore;
    const setTasks = (tasks: Task[]) => { if (platform === 'web') useTaskStore.setState({ tasks }); else useMobileTaskStore.setState({ tasks }); };
    const event = () => ({ preventDefault: () => {} }) as FormEvent;
    const submit = () => platform === 'web' ? () => mocks.webSubmit(event()) : mocks.nativeSubmit;
    const savedSubmit = () => { const saved = platform === 'web' ? mocks.webSubmit : mocks.nativeSubmit; return () => saved(event()); };
    function mount() { act(() => root!.render(createElement(StrictMode, {}, createElement(MemoryRouter, {},
        platform === 'web' ? createElement(TasksPage) : createElement(TasksScreen))))); }
    function edit() { press(platform === 'web' ? '編集' : '編集対象を編集'); }

    describe(`${platform}: task draft ownership`, () => {
        it('通常の編集を保存し、同じcallbackで二重送信しない', () => {
            mount(); edit(); input('保存した名前'); const save = savedSubmit(); act(() => { save(); save(); });
            expect(store.getState().tasks[0].name).toBe('保存した名前'); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it('新規追加を保存し、同じcallbackで二重作成しない', () => {
            mount(); press('新しいタスクを追加'); input('新しい名前'); const save = savedSubmit(); act(() => { save(); save(); });
            expect(store.getState().tasks.map((item) => item.name)).toContain('新しい名前');
            expect(store.getState().tasks).toHaveLength(2); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it.each(['switch', 'logout', 'roundtrip', 'unmount'] as const)('%s後の編集callbackは同IDタスクを変更・送信しない', async (transition) => {
            mount(); edit(); input('旧アカウントの下書き'); const save = savedSubmit();
            await act(async () => {
                if (transition === 'switch') await notifyLogin('b');
                if (transition === 'logout') await notifyLogout();
                if (transition === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); }
                if (transition === 'unmount') unmount();
                setTasks([task()]); save();
            });
            expect(store.getState().tasks[0].name).toBe('編集対象'); expect(mocks.enqueue).not.toHaveBeenCalled();
            expect(host.querySelector('[placeholder="タスク名を入力..."]')).toBeNull();
        });
        it('追加途中の切替で旧入力を消し、新アカウントで新しく作成できる', async () => {
            mount(); press('新しいタスクを追加'); input('旧下書き'); const oldSave = savedSubmit();
            await act(async () => { await notifyLogin('b'); setTasks([task()]); });
            press('新しいタスクを追加');
            expect(host.querySelector<HTMLInputElement>('[placeholder="タスク名を入力..."]')!.value).toBe('');
            input('新下書き'); act(oldSave); expect(mocks.enqueue).not.toHaveBeenCalled();
            act(submit()); expect(store.getState().tasks.map((item) => item.name)).toContain('新下書き');
        });
        it('再描画前のアカウント切替でも旧保存を受け付けない', async () => {
            mount(); edit(); input('古い画面'); const save = savedSubmit();
            await act(async () => { const transition = notifyLogin('b'); setTasks([task()]); save(); await transition; });
            expect(store.getState().tasks[0].name).toBe('編集対象'); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('匿名から初回ログインした場合も未保存の下書きを自動で持ち込まない', async () => {
            await notifyLogout(); mount(); press('新しいタスクを追加'); input('匿名の下書き'); const save = savedSubmit();
            await act(async () => { await notifyLogin('a'); save(); });
            expect(mocks.enqueue).not.toHaveBeenCalled(); expect(host.querySelector('[placeholder="タスク名を入力..."]')).toBeNull();
        });
        if (platform === 'web') it('旧フォームの入力イベントを再開したフォームへ適用しない', () => {
            mount(); edit(); const oldChange = mocks.webChange; const cancel = mocks.cancel;
            act(cancel); edit(); input('現在の入力'); act(() => oldChange('古い入力'));
            expect(host.querySelector<HTMLInputElement>('[placeholder="タスク名を入力..."]')!.value).toBe('現在の入力');
        });
        it('同一ユーザー通知と同値pullは入力を維持して保存できる', async () => {
            mount(); edit(); input('入力を維持');
            await act(async () => { await notifyLogin('a'); setTasks([task()]); });
            expect(host.querySelector<HTMLInputElement>('[placeholder="タスク名を入力..."]')!.value).toBe('入力を維持');
            act(submit()); expect(store.getState().tasks[0].name).toBe('入力を維持'); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it.each(['edited', 'removed', 'subtask', 'completed'] as const)('編集中に%sとなった対象は上書きせず、下書きとエラーを残す', (change) => {
            mount(); edit(); input('手元の入力');
            const current = task();
            if (change === 'edited') current.name = '同期後の名前';
            if (change === 'subtask') current.subtasks = [{ id: 'new', name: '同期後の子', completed: false, completedAt: null, createdAt: current.createdAt }];
            if (change === 'completed') { current.completed = true; current.completedAt = '2026-10-19T01:00:00Z'; }
            act(() => setTasks(change === 'removed' ? [] : [current])); act(submit());
            expect(store.getState().tasks).toEqual(change === 'removed' ? [] : [current]); expect(mocks.enqueue).not.toHaveBeenCalled();
            expect(host.textContent).toContain('このタスクは変更または削除されています');
            expect(host.querySelector<HTMLInputElement>('[placeholder="タスク名を入力..."]')!.value).toBe('手元の入力');
        });
        it('別タスクの同期変更は現在の編集を妨げない', () => {
            mount(); edit(); input('通常更新'); act(() => setTasks([task(), { ...task(), id: 'two', name: '別タスク' }]));
            act(submit()); expect(store.getState().tasks[0].name).toBe('通常更新'); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it('競合後に閉じて開き直すと最新値から通常保存できる', () => {
            mount(); edit(); input('古い入力'); act(() => setTasks([{ ...task(), name: '同期後' }])); act(submit());
            expect(host.textContent).toContain('このタスクは変更または削除されています'); act(mocks.cancel);
            press(platform === 'web' ? '編集' : '同期後を編集');
            expect(host.querySelector<HTMLInputElement>('[placeholder="タスク名を入力..."]')!.value).toBe('同期後');
            input('最新値から更新'); act(submit());
            expect(store.getState().tasks[0].name).toBe('最新値から更新'); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it('取消・再編集後に古い保存や取消が新しい入力を消さない', () => {
            mount(); edit(); input('古い入力'); const oldSave = savedSubmit(); const oldCancel = mocks.cancel;
            act(oldCancel); edit(); input('新しい入力'); act(() => { oldSave(); oldCancel(); });
            expect(mocks.enqueue).not.toHaveBeenCalled(); expect(host.querySelector<HTMLInputElement>('[placeholder="タスク名を入力..."]')!.value).toBe('新しい入力');
            act(submit()); expect(store.getState().tasks[0].name).toBe('新しい入力');
        });
        if (platform === 'native') it('タブ離脱で下書きを破棄し、復帰後も古い保存を受け付けない', () => {
            mount(); edit(); input('離脱前'); const oldSave = savedSubmit();
            act(() => { for (const blur of [...mocks.blurEffects]) blur(); });
            act(() => { for (const focus of [...mocks.focusEffects]) focus(); });
            act(oldSave); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(host.querySelector('[placeholder="タスク名を入力..."]')).toBeNull();
            edit(); input('復帰後'); act(submit()); expect(store.getState().tasks[0].name).toBe('復帰後');
        });
    });
}
