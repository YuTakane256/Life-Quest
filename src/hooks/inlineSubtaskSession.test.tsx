import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { createTask, TASK_LIMITS, type Task } from '@life-quest/core/tasks';
import { TasksPage } from '../pages/TasksPage';
import { useTaskStore } from '../stores/useTaskStore';
import { useMobileTaskStore } from '../../apps/mobile/src/stores/useMobileTaskStore';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(async (..._args: unknown[]) => true),
    actions: new Map<string, (event?: unknown) => void>(), changes: new Map<string, (text: string) => void>(),
    blur: new Set<() => void>(), focus: new Set<() => void>(),
    capture: (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const props = value as Record<string, unknown>;
        const label = props['aria-label'] as string | undefined;
        if (!label) return;
        if (typeof props.onClick === 'function') mocks.actions.set(label, props.onClick as () => void);
        if (typeof props.onSubmit === 'function') mocks.actions.set(label, props.onSubmit as () => void);
        if (typeof props.onChange === 'function') mocks.changes.set(label, (text) => (props.onChange as (event: unknown) => void)({ target: { value: text } }));
    },
}));
// Keep actual DOM/React components while retaining the precise old callbacks, not just detached DOM nodes.
vi.mock('react/jsx-runtime', async (original) => {
    const module = await original<typeof import('react/jsx-runtime')>();
    return { ...module, jsx: (...args: Parameters<typeof module.jsx>) => { mocks.capture(args[1]); return module.jsx(...args); },
        jsxs: (...args: Parameters<typeof module.jsxs>) => { mocks.capture(args[1]); return module.jsxs(...args); } };
});
vi.mock('react/jsx-dev-runtime', async (original) => {
    const module = await original<typeof import('react/jsx-dev-runtime')>();
    return { ...module, jsxDEV: (...args: Parameters<typeof module.jsxDEV>) => { mocks.capture(args[1]); return module.jsxDEV(...args); } };
});
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isWebCloudOutboxActive: () => false }));
vi.mock('../../apps/mobile/src/platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isCloudOutboxActive: () => false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) } }));
vi.mock('../components/ui/snackbarContext', () => ({ useSnackbar: () => ({ showUndo: vi.fn() }) }));
vi.mock('../../apps/mobile/src/hooks/useTaskUndoToast', () => ({ useTaskUndoToast: () => ({ toast: null, showUndo: vi.fn() }) }));
vi.mock('../../apps/mobile/src/components/TaskBottomActions', () => ({ TaskBottomActions: () => null }));
vi.mock('../../apps/mobile/src/theme/usePalette', async () => {
    const { DARK_THEME } = await import('@life-quest/core/designTokens'); return { usePalette: () => ({ palette: DARK_THEME }) };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }), useFocusEffect: (setup: () => (() => void) | undefined) => {
    useEffect(() => {
        let cleanup = setup(); const blur = () => { cleanup?.(); cleanup = undefined; }; const focus = () => { cleanup = setup(); };
        mocks.blur.add(blur); mocks.focus.add(focus);
        return () => { cleanup?.(); mocks.blur.delete(blur); mocks.focus.delete(focus); };
    }, [setup]);
} }));
vi.mock('lucide-react-native', () => import('lucide-react'));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children?: ReactNode }) => createElement('div', {}, children) }));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string; accessibilityRole?: string };
    const box = ({ children }: Props) => createElement('div', {}, children);
    return { Alert: { alert: vi.fn() }, View: box, ScrollView: box, KeyboardAvoidingView: box, Modal: () => null,
        Text: ({ children, accessibilityRole }: Props) => createElement('span', { role: accessibilityRole }, children),
        TextInput: ({ value, accessibilityLabel, onChangeText }: { value?: string; accessibilityLabel?: string; onChangeText?: (text: string) => void }) => {
            if (accessibilityLabel && onChangeText) mocks.changes.set(accessibilityLabel, onChangeText);
            return createElement('input', { value, 'aria-label': accessibilityLabel, onChange: (event) => onChangeText?.(event.target.value) });
        },
        Pressable: ({ children, onPress, disabled, accessibilityLabel }: Props) => {
            if (accessibilityLabel && onPress) mocks.actions.set(accessibilityLabel, onPress);
            return createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children);
        },
        FlatList: ({ ListHeaderComponent, data, renderItem }: { ListHeaderComponent?: ReactNode; data: Task[]; renderItem: (value: { item: Task }) => ReactNode }) =>
            createElement('div', {}, createElement('div', { key: 'header' }, ListHeaderComponent), data.map((item) => createElement('div', { key: item.id }, renderItem({ item })))),
        Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove: vi.fn() }) }, Platform: { OS: 'ios' }, Share: { share: vi.fn(async () => {}) }, StyleSheet: { create: <T,>(value: T) => value },
    };
});
const nativeModule = '../../apps/mobile/src/screens/TasksScreen';
const { default: TasksScreen } = await import(nativeModule);
const task = (): Task => ({ ...createTask({ id: 'one', name: '対象', now: '2026-10-20T00:00:00Z' })!, subtasks: ['a', 'b'].map((id) => ({
    id, name: id, completed: false, completedAt: null, createdAt: '2026-10-20T00:00:00Z',
})) });
let host: HTMLDivElement; let root: Root | null;
const event = () => ({ preventDefault: () => {} });
function unmount() { if (root) act(() => { root!.unmount(); root = null; }); }
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); setGameRewardAuthorityState('authenticated'); vi.clearAllMocks(); mocks.actions.clear(); mocks.changes.clear();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
    useTaskStore.setState({ tasks: [task()], pendingCompletions: [] });
    useMobileTaskStore.setState({ tasks: [task()], pendingCompletions: [], hasHydrated: true });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { unmount(); host.remove(); resetAuthLifecycleHooks(); setGameRewardAuthorityState('resolving'); vi.unstubAllGlobals(); });

for (const platform of ['web', 'native'] as const) {
    const store = platform === 'web' ? useTaskStore : useMobileTaskStore;
    const setTasks = (tasks: Task[]) => { if (platform === 'web') useTaskStore.setState({ tasks }); else useMobileTaskStore.setState({ tasks }); };
    const fieldLabel = platform === 'web' ? 'タスク「対象」のサブタスク名' : 'サブタスクを追加';
    const addLabel = platform === 'web' ? 'タスク「対象」のサブタスク追加' : '対象にサブタスクを追加';
    const toggleLabel = platform === 'web' ? 'サブタスク「a」を完了にする' : 'サブタスクaを完了にする';
    const deleteLabel = platform === 'web' ? 'サブタスク「a」を削除' : 'サブタスクaを削除';
    const action = (label: string) => { const callback = mocks.actions.get(label); expect(callback, label).toBeDefined(); return () => callback!(event()); };
    const change = (text: string) => { const callback = mocks.changes.get(fieldLabel); expect(callback, fieldLabel).toBeDefined(); act(() => callback!(text)); };
    const mount = () => act(() => root!.render(createElement(StrictMode, {}, createElement(MemoryRouter, {}, platform === 'web' ? createElement(TasksPage) : createElement(TasksScreen)))));
    const field = () => host.querySelector<HTMLInputElement>(`[aria-label='${fieldLabel}']`)!;
    describe(`${platform}: inline subtask operations`, () => {
        it('通常追加は一度だけ送信して入力を空にする', () => {
            mount(); change('追加'); const add = action(addLabel); act(() => { add(); add(); });
            expect(store.getState().tasks[0].subtasks.map((item) => item.name)).toEqual(['a', 'b', '追加']); expect(field().value).toBe('');
            expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith('upsert_subtask', expect.objectContaining({ p_task_id: 'one', p_name: '追加' }), expect.anything());
        });
        it.each(['switch', 'logout', 'roundtrip', 'unmount'])('%s後は旧追加・入力・完了・削除を拒否する', async (transition) => {
            mount(); change('古い入力'); const add = action(addLabel); const toggle = action(toggleLabel); const remove = action(deleteLabel); const oldChange = mocks.changes.get(fieldLabel)!;
            await act(async () => {
                if (transition === 'switch') await notifyLogin('b'); if (transition === 'logout') await notifyLogout();
                if (transition === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); } if (transition === 'unmount') unmount();
                setTasks([task()]); oldChange('復活させない'); add(); toggle(); remove();
            });
            expect(store.getState().tasks).toEqual([task()]); expect(mocks.enqueue).not.toHaveBeenCalled();
            if (transition !== 'unmount') expect(field().value).toBe('');
        });
        it('認証切替の再描画前も入力と直接操作を拒否する', async () => {
            mount(); change('旧入力'); const add = action(addLabel); const toggle = action(toggleLabel); const remove = action(deleteLabel);
            await act(async () => { const pending = notifyLogin('b'); setTasks([task()]); add(); toggle(); remove(); await pending; });
            expect(store.getState().tasks).toEqual([task()]); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(field().value).toBe('');
        });
        it('同一ユーザー通知・同値pullでは下書きを維持する', async () => {
            mount(); change('保持'); await act(async () => { await notifyLogin('a'); setTasks([task()]); }); act(action(addLabel));
            expect(store.getState().tasks[0].subtasks.at(-1)?.name).toBe('保持'); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it.each(['name', 'createdAt', 'subtask', 'completed'])('%s変更後は下書きを残し追加を止める', (kind) => {
            mount(); change('保持する入力'); const add = action(addLabel); const toggle = action(toggleLabel); const remove = action(deleteLabel); const target = task();
            if (kind === 'name') target.name = '変更'; if (kind === 'createdAt') target.createdAt = '2026-10-21T00:00:00Z';
            if (kind === 'subtask') target.subtasks[0].name = '同期後'; if (kind === 'completed') { target.completed = true; target.completedAt = target.createdAt; }
            // Moving into the completed group unmounts the input on both platforms.
            if (kind === 'completed') {
                act(() => { setTasks([target]); add(); toggle(); remove(); }); expect(mocks.enqueue).not.toHaveBeenCalled(); return;
            }
            act(() => { setTasks([target]); add(); toggle(); remove(); });
            expect(store.getState().tasks).toEqual([target]); expect(mocks.enqueue).not.toHaveBeenCalled();
            expect(host.textContent).toContain('このタスクは変更されています');
            expect(host.querySelector<HTMLInputElement>('[placeholder="サブタスクを追加..."]')?.value ?? field().value).toBe('保持する入力');
        });
        it('上限失敗は入力とエラーを残し、やり直せる', () => {
            const target = task(); target.subtasks = Array.from({ length: TASK_LIMITS.maxSubtasks }, (_, index) => ({ ...target.subtasks[0], id: String(index), name: String(index) })); setTasks([target]);
            mount(); change('失わない'); act(action(addLabel));
            expect(field().value).toBe('失わない'); expect(host.textContent).toContain('上限を確認'); expect(mocks.enqueue).not.toHaveBeenCalled();
            const button = [...host.querySelectorAll('button')].find((item) => item.textContent === '入力をやり直す')!; act(() => button.click()); expect(field().value).toBe('');
        });
        it('入力を消して再入力すると旧追加は無効、新しい追加だけ有効', () => {
            mount(); change('前の入力'); const old = action(addLabel); change(''); change('新しい入力');
            act(() => { old(); action(addLabel)(); }); expect(store.getState().tasks[0].subtasks.at(-1)?.name).toBe('新しい入力'); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it('完了の連打は一度だけ送信し、未完了への反転や削除はしない', () => {
            mount(); const toggle = action(toggleLabel); const remove = action(deleteLabel); act(() => { toggle(); toggle(); remove(); });
            expect(store.getState().tasks[0].subtasks[0].completed).toBe(true); expect(store.getState().tasks[0].subtasks).toHaveLength(2);
            expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith('complete_subtask', { subtaskId: 'a' }, expect.anything());
        });
        it('削除の連打で余分な送信をしない', () => {
            mount(); const remove = action(deleteLabel); act(() => { remove(); remove(); });
            expect(store.getState().tasks[0].subtasks.map((item) => item.id)).toEqual(['b']); expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith('delete_subtask', { p_id: 'a' }, expect.anything());
        });
        it('折りたたみ・再展開後は旧入力と旧操作を受け付けない', () => {
            mount(); change('破棄される入力'); const add = action(addLabel); const toggle = action(toggleLabel); const remove = action(deleteLabel); const oldChange = mocks.changes.get(fieldLabel)!;
            act(action('タスク「対象」を折りたたむ')); act(action('タスク「対象」を展開'));
            act(() => { oldChange('復活'); add(); toggle(); remove(); });
            expect(field().value).toBe(''); expect(store.getState().tasks).toEqual([task()]); expect(mocks.enqueue).not.toHaveBeenCalled();
            change('再開後'); act(action(addLabel)); expect(store.getState().tasks[0].subtasks.at(-1)?.name).toBe('再開後');
        });
        if (platform === 'native') it('読込中の追加失敗も下書きを残し、復元後に保存できる', () => {
            useMobileTaskStore.setState({ hasHydrated: false }); mount(); change('復元待ち'); const add = action(addLabel); act(add);
            expect(field().value).toBe('復元待ち'); expect(host.textContent).toContain('読み込み状態'); expect(mocks.enqueue).not.toHaveBeenCalled();
            act(() => { useMobileTaskStore.setState({ hasHydrated: true }); }); act(action(addLabel));
            expect(store.getState().tasks[0].subtasks.at(-1)?.name).toBe('復元待ち'); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        if (platform === 'native') it('タブへ戻っても旧入力・操作は無効、新しい入力は保存できる', () => {
            mount(); change('離脱前'); const add = action(addLabel); const toggle = action(toggleLabel); const remove = action(deleteLabel); const oldChange = mocks.changes.get(fieldLabel)!;
            act(() => { [...mocks.blur].forEach((callback) => callback()); [...mocks.focus].forEach((callback) => callback()); oldChange('復活'); add(); toggle(); remove(); });
            expect(store.getState().tasks).toEqual([task()]); expect(field().value).toBe(''); expect(mocks.enqueue).not.toHaveBeenCalled();
            change('復帰後'); act(action(addLabel)); expect(store.getState().tasks[0].subtasks.at(-1)?.name).toBe('復帰後'); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
    });
}
