import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createTask, type Task } from '@life-quest/core/tasks';
import type { Habit, HabitDailyRecord } from '@life-quest/core/habits';
import { TasksPage } from '../pages/TasksPage';
import { HabitsPage } from '../pages/HabitsPage';
import { useTaskStore } from '../stores/useTaskStore';
import { useHabitStore } from '../stores/useHabitStore';
import { useMobileTaskStore } from '../../apps/mobile/src/stores/useMobileTaskStore';
import { useMobileHabitStore } from '../../apps/mobile/src/stores/useMobileHabitStore';

const mocks = vi.hoisted(() => ({ alert: vi.fn(), enqueue: vi.fn(async (..._args: unknown[]) => true),
    confirm: () => {}, cancel: () => {}, blur: () => {}, focus: () => {}, presses: new Map<string, () => void>(),
    blurEffects: new Set<() => void>(), focusEffects: new Set<() => void>(),
}));
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
    return { AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) }, Alert: { alert: mocks.alert }, View: box, ScrollView: box, KeyboardAvoidingView: box, Modal: () => null,
        Text: ({ children }: Props) => createElement('span', {}, children), TextInput: () => null,
        Pressable: ({ children, onPress, disabled, accessibilityLabel }: Props) => {
            if (accessibilityLabel && onPress) mocks.presses.set(accessibilityLabel, onPress);
            return createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children);
        },
        FlatList: ({ ListHeaderComponent, data, renderItem }: { ListHeaderComponent?: ReactNode; data: Task[]; renderItem: (value: { item: Task }) => ReactNode }) =>
            createElement('div', {}, createElement('div', { key: 'header' }, ListHeaderComponent), data.map((item) => createElement('div', { key: item.id }, renderItem({ item })))),
        SectionList: ({ ListHeaderComponent, sections, renderItem }: { ListHeaderComponent: ReactNode; sections: { data: { habit: Habit }[] }[];
            renderItem: (value: { item: { habit: Habit }; section: unknown }) => ReactNode }) =>
            createElement('div', {}, createElement('div', { key: 'header' }, ListHeaderComponent), sections.flatMap((section) => section.data.map((item) =>
                createElement('div', { key: item.habit.id }, renderItem({ item, section }))))),
        Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove: vi.fn() }) }, Platform: { OS: 'ios' }, Share: { share: vi.fn(async () => {}) },
        StyleSheet: { create: <T,>(value: T) => value },
    };
});
const taskModule = '../../apps/mobile/src/screens/TasksScreen';
const habitModule = '../../apps/mobile/src/screens/HabitsScreen';
const { default: TasksScreen } = await import(taskModule);
const { default: HabitsScreen } = await import(habitModule);
const task = (id = 'one'): Task => createTask({ id, name: id, now: '2026-10-19T00:00:00Z' })!;
const habit = (id = 'one'): Habit => ({ id, name: id, categoryId: 'study', createdAt: '2026-10-19T00:00:00Z' });
const record = (id = 'one'): HabitDailyRecord => ({ habitId: id, date: '2026-10-19', completed: true, memo: '履歴メモ' });
let host: HTMLDivElement; let root: Root | null;
function unmount() { if (root) act(() => { root!.unmount(); root = null; }); }
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.clearAllMocks(); mocks.presses.clear(); vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00+09:00')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
    useTaskStore.setState({ tasks: [task(), task('two')], pendingCompletions: [] });
    useMobileTaskStore.setState({ tasks: [task(), task('two')], pendingCompletions: [], hasHydrated: true });
    useHabitStore.setState({ habits: [habit(), habit('two')], dailyRecords: [record(), record('two')], restDays: [], allCompleteRewardDates: [] });
    useMobileHabitStore.setState({ habits: [habit(), habit('two')], records: [record(), record('two')], restDays: [], rewardEligibleDates: [], hasHydrated: true });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { unmount(); host.remove(); resetAuthLifecycleHooks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

for (const platform of ['web', 'native'] as const) for (const kind of ['task', 'habit'] as const) {
    const items = () => kind === 'task' ? (platform === 'web' ? useTaskStore.getState().tasks : useMobileTaskStore.getState().tasks)
        : (platform === 'web' ? useHabitStore.getState().habits : useMobileHabitStore.getState().habits);
    const records = () => platform === 'web' ? useHabitStore.getState().dailyRecords : useMobileHabitStore.getState().records;
    const setRecords = (entries: HabitDailyRecord[]) => { if (platform === 'web') useHabitStore.setState({ dailyRecords: entries }); else useMobileHabitStore.setState({ records: entries }); };
    const setItems = (change: 'name' | 'createdAt' | 'missing' | 'same' = 'same') => {
        if (kind === 'task') {
            const target = task(); if (change === 'name') target.name = '同期後'; if (change === 'createdAt') target.createdAt = '2026-10-20T00:00:00Z';
            const tasks = change === 'missing' ? [task('two')] : [target, task('two')];
            if (platform === 'web') useTaskStore.setState({ tasks }); else useMobileTaskStore.setState({ tasks });
        } else {
            const target = habit(); if (change === 'name') target.name = '同期後'; if (change === 'createdAt') target.createdAt = '2026-10-20T00:00:00Z';
            const habits = change === 'missing' ? [habit('two')] : [target, habit('two')];
            if (platform === 'web') useHabitStore.setState({ habits }); else useMobileHabitStore.setState({ habits });
        }
    };
    const mount = () => act(() => root!.render(createElement(StrictMode, {}, createElement(MemoryRouter, {},
        kind === 'task' ? (platform === 'web' ? createElement(TasksPage) : createElement(TasksScreen)) : (platform === 'web' ? createElement(HabitsPage) : createElement(HabitsScreen))))));
    const request = (id = 'one') => {
        const label = platform === 'native' && kind === 'task' ? `${id}を削除` : `「${id}」を削除`;
        const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.getAttribute('aria-label') === label);
        expect(button, label).toBeDefined(); act(() => button!.click());
        if (platform === 'web') return { confirm: mocks.confirm, cancel: mocks.cancel, dismiss: mocks.cancel };
        const call = mocks.alert.mock.calls.at(-1)!;
        return { confirm: call[2].find((item: { text: string }) => item.text === '削除する').onPress as () => void,
            cancel: call[2].find((item: { text: string }) => item.text === 'キャンセル').onPress as () => void,
            dismiss: call[3].onDismiss as () => void };
    };
    describe(`${platform}: individual ${kind} deletion`, () => {
        it('押すだけでは削除せず、確定で対象だけ一度削除・送信する', () => {
            mount(); const approval = request(); expect(items()).toHaveLength(2); expect(mocks.enqueue).not.toHaveBeenCalled();
            if (platform === 'web') expect(host.querySelector('[role="dialog"]')!.textContent).toContain(kind === 'task' ? 'サブタスク' : '達成履歴・メモ');
            act(() => { approval.confirm(); approval.confirm(); });
            expect(items().map((item) => item.id)).toEqual(['two']); expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(
                kind === 'task' ? 'delete_task' : 'delete_habit', { p_id: 'one' }, { dependsOnEntityIds: ['one'] });
            if (kind === 'habit') expect(records()).toEqual([record('two')]);
        });
        it.each(['cancel', 'dismiss'] as const)('%s後は旧確定を拒否する', (method) => {
            mount(); const approval = request(); act(() => { approval[method](); approval.confirm(); });
            expect(items()).toHaveLength(2); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('古い取消・確定は新しい確認に影響しない', () => {
            mount(); const old = request(); act(old.cancel); const current = request('two');
            act(() => { old.cancel(); old.confirm(); current.confirm(); });
            expect(items().map((item) => item.id)).toEqual(['one']); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it.each(['switch', 'logout', 'roundtrip', 'unmount'] as const)('%s後の同IDデータを旧確認で消さない', async (transition) => {
            mount(); const approval = request();
            await act(async () => {
                if (transition === 'switch') await notifyLogin('b');
                if (transition === 'logout') await notifyLogout();
                if (transition === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); }
                if (transition === 'unmount') unmount();
                setItems(); approval.confirm();
            });
            expect(items()).toHaveLength(2); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('認証切替の再描画前にも旧確認を無効にする', async () => {
            mount(); const approval = request();
            await act(async () => { const pending = notifyLogin('b'); setItems(); approval.confirm(); await pending; });
            expect(items()).toHaveLength(2); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('同一ユーザー通知・同値pullでは確認を維持する', async () => {
            mount(); const approval = request();
            await act(async () => { await notifyLogin('a'); setItems(); if (kind === 'habit') setRecords([record('two'), record()]); });
            act(approval.confirm); expect(items().map((item) => item.id)).toEqual(['two']); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it.each(['name', 'createdAt', 'missing'] as const)('%sになった対象を削除せず再確認を案内する', (change) => {
            mount(); const approval = request(); act(() => { setItems(change); approval.confirm(); });
            expect(items()).toHaveLength(change === 'missing' ? 1 : 2); expect(mocks.enqueue).not.toHaveBeenCalled();
            if (platform === 'web') expect(host.querySelector('[role="alert"]')!.textContent).toContain('削除し直してください');
            else expect(mocks.alert).toHaveBeenLastCalledWith('削除できませんでした', expect.stringContaining('削除し直してください'));
        });
        if (platform === 'native') it('タブ離脱後に戻っても旧Alertは無効、新しい確認は使える', () => {
            mount(); const old = request(); act(() => { mocks.blur(); mocks.focus(); old.confirm(); });
            expect(mocks.enqueue).not.toHaveBeenCalled(); const next = request(); act(next.confirm); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        if (kind === 'habit') it.each(['memo', 'completion', 'new-record', 'missing-record'] as const)('%sの変更後は履歴ごと消さない', (change) => {
            mount(); const approval = request();
            act(() => {
                const entry = record(); if (change === 'memo') entry.memo = '同期後'; if (change === 'completion') entry.completed = false;
                setRecords(change === 'missing-record' ? [record('two')] : [entry, record('two'), ...(change === 'new-record' ? [{ ...record(), date: '2026-10-18' }] : [])]);
                approval.confirm();
            });
            expect(items()).toHaveLength(2); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        if (kind === 'task') {
            it('確認中に変わったサブタスクをまとめて消さない', () => {
                mount(); const approval = request(); const target = { ...task(), subtasks: [{ id: 'sub', name: '追加', completed: false, completedAt: null, createdAt: task().createdAt }] };
                act(() => { if (platform === 'web') useTaskStore.setState({ tasks: [target] }); else useMobileTaskStore.setState({ tasks: [target] }); approval.confirm(); });
                expect(items()).toHaveLength(1); expect(mocks.enqueue).not.toHaveBeenCalled();
            });
            it('Undo待機状態が変わった場合は削除しない', () => {
                mount(); const approval = request();
                act(() => {
                    const pending = { taskId: 'one', completedAt: '2026-10-19T01:00:00Z' };
                    if (platform === 'web') useTaskStore.setState({ pendingCompletions: [{ ...pending, timeoutId: window.setTimeout(() => {}, 60000) }] });
                    else useMobileTaskStore.setState({ pendingCompletions: [{ ...pending, timeoutId: setTimeout(() => {}, 60000) }] });
                    approval.confirm();
                });
                expect(items()).toHaveLength(2); expect(mocks.enqueue).not.toHaveBeenCalled();
            });
        }
    });
}
