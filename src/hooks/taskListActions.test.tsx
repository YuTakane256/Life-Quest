import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { createTask, type Task } from '@life-quest/core/tasks';
import { TasksPage } from '../pages/TasksPage';
import { useTaskStore } from '../stores/useTaskStore';
import { useMobileTaskStore } from '../../apps/mobile/src/stores/useMobileTaskStore';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(async (..._args: unknown[]) => true), alert: vi.fn(), share: vi.fn(async (..._args: unknown[]) => {}),
    undo: vi.fn((_message: string, _callback: () => void) => {}), csv: '', createUrl: vi.fn(() => 'blob:fixture'), revokeUrl: vi.fn(), click: vi.fn(),
    actions: new Map<string, (event?: unknown) => void>(), changes: new Map<string, (text: string) => void>(),
    filters: {} as Record<string, unknown>, blur: new Set<() => void>(), focus: new Set<() => void>(),
    appState: 'active', appListeners: new Set<() => void>(),
    capture: (value: unknown) => {
        if (!value || typeof value !== 'object') return; const props = value as Record<string, unknown>;
        if (typeof props.onSearchQueryChange === 'function') mocks.filters = props;
        const label = (props['aria-label'] ?? props.placeholder) as string | undefined; if (!label) return;
        if (typeof props.onClick === 'function') mocks.actions.set(label, props.onClick as () => void);
        if (typeof props.onChange === 'function') mocks.changes.set(label, (text) => (props.onChange as (event: unknown) => void)({ target: { value: text } }));
    },
}));
vi.mock('react/jsx-runtime', async (original) => { const module = await original<typeof import('react/jsx-runtime')>(); return { ...module,
    jsx: (...args: Parameters<typeof module.jsx>) => { mocks.capture(args[1]); return module.jsx(...args); },
    jsxs: (...args: Parameters<typeof module.jsxs>) => { mocks.capture(args[1]); return module.jsxs(...args); },
}; });
vi.mock('react/jsx-dev-runtime', async (original) => { const module = await original<typeof import('react/jsx-dev-runtime')>(); return { ...module,
    jsxDEV: (...args: Parameters<typeof module.jsxDEV>) => { mocks.capture(args[1]); return module.jsxDEV(...args); },
}; });
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isWebCloudOutboxActive: () => false }));
vi.mock('../../apps/mobile/src/platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isCloudOutboxActive: () => false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) } }));
vi.mock('../components/ui/snackbarContext', () => ({ useSnackbar: () => ({ showUndo: mocks.undo }) }));
vi.mock('../../apps/mobile/src/hooks/useTaskUndoToast', () => ({ useTaskUndoToast: () => ({ toast: null, showUndo: mocks.undo }) }));
vi.mock('../../apps/mobile/src/components/TaskBottomActions', () => ({ TaskBottomActions: () => null }));
vi.mock('../../apps/mobile/src/theme/usePalette', async () => { const { DARK_THEME } = await import('@life-quest/core/designTokens'); return { usePalette: () => ({ palette: DARK_THEME }) }; });
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }), useFocusEffect: (setup: () => (() => void) | undefined) => {
    useEffect(() => { let cleanup = setup(); const blur = () => { cleanup?.(); cleanup = undefined; }; const focus = () => { cleanup = setup(); };
        mocks.blur.add(blur); mocks.focus.add(focus); return () => { cleanup?.(); mocks.blur.delete(blur); mocks.focus.delete(focus); };
    }, [setup]);
} }));
vi.mock('lucide-react-native', () => import('lucide-react'));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children?: ReactNode }) => createElement('div', {}, children) }));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; onPress?: () => void; onLongPress?: () => void; disabled?: boolean; accessibilityLabel?: string; accessibilityRole?: string; accessibilityState?: { selected?: boolean } };
    const box = ({ children }: Props) => createElement('div', {}, children);
    return { AppState: { get currentState() { return mocks.appState; }, addEventListener: (_: string, listener: () => void) => {
        mocks.appListeners.add(listener); return { remove: () => mocks.appListeners.delete(listener) };
    } }, Alert: { alert: mocks.alert }, View: box, ScrollView: box, KeyboardAvoidingView: box, Modal: () => null,
        Text: ({ children, accessibilityRole }: Props) => createElement('span', { role: accessibilityRole }, children),
        TextInput: ({ value, accessibilityLabel, placeholder, onChangeText }: { value?: string; accessibilityLabel?: string; placeholder?: string; onChangeText?: (text: string) => void }) => {
            if ((accessibilityLabel || placeholder) && onChangeText) mocks.changes.set(accessibilityLabel || placeholder!, onChangeText);
            return createElement('input', { value, placeholder, 'aria-label': accessibilityLabel, onChange: (event) => onChangeText?.(event.target.value) });
        },
        Pressable: ({ children, onPress, onLongPress, disabled, accessibilityLabel, accessibilityState }: Props) => {
            if (accessibilityLabel && onPress) mocks.actions.set(accessibilityLabel, onPress);
            if (accessibilityLabel && onLongPress) mocks.actions.set(`${accessibilityLabel}:long`, onLongPress);
            return createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel, 'aria-pressed': accessibilityState?.selected }, children);
        },
        FlatList: ({ ListHeaderComponent, ListFooterComponent, data, renderItem }: { ListHeaderComponent?: ReactNode; ListFooterComponent?: ReactNode; data: Task[]; renderItem: (value: { item: Task }) => ReactNode }) =>
            createElement('div', {}, createElement('div', { key: 'header' }, ListHeaderComponent), data.map((item) => createElement('div', { key: item.id }, renderItem({ item }))), createElement('div', { key: 'footer' }, ListFooterComponent)),
        Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove: vi.fn() }) }, Platform: { OS: 'ios' }, Share: { share: mocks.share }, StyleSheet: { create: <T,>(value: T) => value },
    };
});
const nativeModule = '../../apps/mobile/src/screens/TasksScreen';
const { default: TasksScreen } = await import(nativeModule);
const task = (): Task => ({ ...createTask({ id: 'one', name: '対象', now: '2026-10-20T00:00:00Z' })!, tags: ['tag'] });
let host: HTMLDivElement; let root: Root | null;
function unmount() { if (root) act(() => { root!.unmount(); root = null; }); }
function deferred() { let resolve!: () => void; let reject!: () => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = () => no(new Error('fixture')); }); return { promise, resolve, reject }; }
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); setGameRewardAuthorityState('authenticated'); vi.clearAllMocks(); mocks.actions.clear(); mocks.changes.clear(); mocks.filters = {};
    mocks.share.mockReset().mockResolvedValue(undefined); mocks.click.mockReset(); mocks.createUrl.mockReset().mockReturnValue('blob:fixture'); mocks.csv = '';
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T12:00:00+09:00')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
    mocks.appState = 'active'; mocks.appListeners.clear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const OriginalURL = URL; vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = mocks.createUrl; static revokeObjectURL = mocks.revokeUrl; });
    const OriginalBlob = Blob; vi.stubGlobal('Blob', class extends OriginalBlob { constructor(...args: ConstructorParameters<typeof Blob>) { super(...args); mocks.csv = String(args[0]?.[0]); } });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(mocks.click);
    useTaskStore.setState({ tasks: [task()], pendingCompletions: [] }); useMobileTaskStore.setState({ tasks: [task()], pendingCompletions: [], hasHydrated: true });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { unmount(); host.remove(); resetAuthLifecycleHooks(); setGameRewardAuthorityState('resolving'); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, 'visibilityState'); });

for (const platform of ['web', 'native'] as const) {
    const store = platform === 'web' ? useTaskStore : useMobileTaskStore;
    const setTasks = (tasks: Task[]) => { if (platform === 'web') useTaskStore.setState({ tasks }); else useMobileTaskStore.setState({ tasks }); };
    const mount = () => act(() => root!.render(createElement(StrictMode, {}, createElement(MemoryRouter, {}, platform === 'web' ? createElement(TasksPage) : createElement(TasksScreen)))));
    const action = (label: string) => { const callback = mocks.actions.get(label); expect(callback, label).toBeDefined(); return () => callback!(); };
    const completeLabel = platform === 'web' ? 'タスク「対象」を完了にする' : '対象を完了にする';
    const uncompleteLabel = platform === 'web' ? 'タスク「対象」を未完了にする' : '対象を未完了にする';
    const duplicateLabel = platform === 'web' ? '複製' : '対象を複製';
    const editLabel = platform === 'web' ? '編集' : '対象を編集';
    const csvLabel = platform === 'web' ? 'タスクをCSVで保存' : 'タスクをCSVで共有';
    const undo = () => mocks.undo.mock.calls.at(-1)![1];
    const exportCount = () => platform === 'web' ? mocks.click.mock.calls.length : mocks.share.mock.calls.length;
    const csvText = () => platform === 'web' ? mocks.csv : (mocks.share.mock.calls.at(-1)![0] as { message: string }).message;
    const transition = async (kind: string) => {
        if (kind === 'switch') await notifyLogin('b'); if (kind === 'logout') await notifyLogout();
        if (kind === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); } if (kind === 'unmount') unmount();
    };
    describe(`${platform}: task dates without store changes`, () => {
        const prepare = () => {
            vi.setSystemTime(new Date('2026-10-20T23:59:59+09:00'));
            const items = [{ ...task(), dueDate: '2026-10-20' }, { ...task(), id: 'two', name: '翌日期限', dueDate: '2026-10-21' },
                { ...task(), id: 'none', name: '期限なし', dueDate: null }];
            setTasks(items); mount(); return store.getState().tasks;
        };
        const filter = (text: string) => act(() => {
            const button = [...host.querySelectorAll('button')].find((item) => platform === 'web' ? item.textContent === text : item.getAttribute('aria-label') === `期限フィルター ${text}`);
            expect(button).toBeDefined(); button!.click();
        });
        const row = (name: string) => [...host.querySelectorAll('button')].some((item) => item.getAttribute('aria-label') === (platform === 'web' ? `タスク「${name}」を完了にする` : `${name}を完了にする`));
        const midnight = async () => { await act(async () => vi.advanceTimersByTimeAsync(1000)); };
        it('午前0時に相対日付が変わり、保存/同期/完了待ちを書き換えない', async () => {
            const items = prepare(); expect(host.textContent).toContain('📅 今日'); expect(host.textContent).toContain('📅 明日');
            await midnight(); expect(host.textContent).toContain('📅 昨日'); expect(host.textContent).not.toContain('📅 明日');
            expect(store.getState().tasks).toBe(items); expect(store.getState().pendingCompletions).toEqual([]); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it.each(['今日まで', '期限切れ'])('%sの表示対象をデータ更新なしで再計算する', async (text) => {
            const items = prepare(); filter(text);
            expect(row('対象')).toBe(text === '今日まで'); expect(row('翌日期限')).toBe(false);
            await midnight(); expect(row('対象')).toBe(true); expect(row('翌日期限')).toBe(text === '今日まで'); expect(row('期限なし')).toBe(false);
            expect(store.getState().tasks).toBe(items); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('入力中の編集内容・検索条件を日付更新で消さない', async () => {
            const items = prepare(); act(action(editLabel));
            const change = mocks.changes.get(platform === 'web' ? 'タスク名を入力...' : 'タスク名'); expect(change).toBeDefined(); act(() => change!('入力中の下書き'));
            if (platform === 'web') act(() => (mocks.filters.onSearchQueryChange as (value: string) => void)('対象'));
            else act(() => mocks.changes.get('タスクを検索')!('対象'));
            await midnight(); expect(host.querySelector<HTMLInputElement>('[placeholder="タスク名を入力..."]')?.value).toBe('入力中の下書き');
            expect(row('対象')).toBe(true); expect(row('翌日期限')).toBe(false); expect(store.getState().tasks).toBe(items); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('日付更新をまたいでも同じ完了待機をUndoできる', async () => {
            prepare(); act(action(completeLabel)); const pending = store.getState().pendingCompletions[0]; const cancel = undo();
            await midnight(); expect(store.getState().pendingCompletions[0]).toBe(pending); act(cancel);
            expect(store.getState().tasks[0].completed).toBe(false); expect(store.getState().pendingCompletions).toEqual([]); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('非表示中に日付が進んでも、前景復帰で条件を維持して再計算する', () => {
            const items = prepare(); filter('今日まで');
            const visibility = (active: boolean) => {
                if (platform === 'native') { mocks.appState = active ? 'active' : 'background'; for (const listener of mocks.appListeners) listener(); }
                else { Object.defineProperty(document, 'visibilityState', { configurable: true, value: active ? 'visible' : 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
            };
            act(() => visibility(false)); vi.setSystemTime(new Date('2026-10-22T08:00:00+09:00'));
            expect(row('翌日期限')).toBe(false); act(() => visibility(true)); expect(row('翌日期限')).toBe(true); expect(row('期限なし')).toBe(false);
            expect(host.textContent).toContain('📅 2日前'); expect(store.getState().tasks).toBe(items); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        if (platform === 'native') it('別タブから翌日に戻ると日付を更新し、日付リスナーは離脱/終了で解除する', () => {
            prepare(); expect(mocks.appListeners.size).toBe(1); act(() => { for (const callback of mocks.blur) callback(); }); expect(mocks.appListeners.size).toBe(0);
            vi.setSystemTime(new Date('2026-10-21T08:00:00+09:00')); act(() => { for (const callback of mocks.focus) callback(); });
            expect(host.textContent).toContain('📅 昨日'); expect(host.textContent).not.toContain('📅 明日'); expect(mocks.appListeners.size).toBe(1);
            unmount(); expect(mocks.appListeners.size).toBe(0); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        if (platform === 'web') it('ウィンドウのフォーカス復帰でも日付と期限切れ一覧を更新する', () => {
            prepare(); filter('期限切れ'); vi.setSystemTime(new Date('2026-10-21T08:00:00+09:00'));
            act(() => window.dispatchEvent(new Event('focus'))); expect(row('対象')).toBe(true); expect(row('翌日期限')).toBe(false); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
    });
    describe(`${platform}: task row actions and owned Undo`, () => {
        it('同一完了callbackの重複実行は反転せず、同じUndo待機だけ戻す', () => {
            mount(); const complete = action(completeLabel); act(() => { complete(); complete(); });
            expect(store.getState().tasks[0].completed).toBe(true); expect(store.getState().pendingCompletions).toHaveLength(1); expect(mocks.undo).toHaveBeenCalledOnce();
            act(undo()); expect(store.getState().tasks[0].completed).toBe(false); expect(store.getState().pendingCompletions).toEqual([]); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('通常の未完了化は一度だけ送信する', () => {
            setTasks([{ ...task(), completed: true, completedAt: task().createdAt }]); mount();
            if (platform === 'native') act(action('完了タスク (1)'));
            const reopen = action(uncompleteLabel); act(() => { reopen(); reopen(); });
            expect(store.getState().tasks[0].completed).toBe(false); expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith('uncomplete_task', { p_id: 'one' }, expect.anything());
        });
        it('同一複製callbackは一度だけ動き、未変更の複製だけUndoで消す', () => {
            mount(); const duplicate = action(duplicateLabel); act(() => { duplicate(); duplicate(); });
            expect(store.getState().tasks).toHaveLength(2); expect(mocks.undo).toHaveBeenCalledOnce();
            act(undo()); expect(store.getState().tasks).toEqual([task()]); expect(mocks.enqueue).toHaveBeenCalledTimes(2);
        });
        it.each(['name', 'tags', 'subtask', 'completed', 'createdAt'])('複製の%s変更後は古いUndoで削除しない', (kind) => {
            mount(); act(action(duplicateLabel)); const cancel = undo();
            const clone = structuredClone(store.getState().tasks[1]);
            if (kind === 'name') clone.name = '編集した複製'; if (kind === 'tags') clone.tags = ['新タグ'];
            if (kind === 'createdAt') clone.createdAt = '2026-10-21T00:00:00Z'; if (kind === 'completed') { clone.completed = true; clone.completedAt = clone.createdAt; }
            if (kind === 'subtask') clone.subtasks.push({ id: 'child', name: '新しい子', completed: false, completedAt: null, createdAt: clone.createdAt });
            act(() => { setTasks([task(), clone]); cancel(); }); expect(store.getState().tasks).toEqual([task(), clone]); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it('同値pull・同一ユーザー通知では複製Undoを維持する', async () => {
            mount(); act(action(duplicateLabel)); const cancel = undo(); const copy = structuredClone(store.getState().tasks);
            await act(async () => { await notifyLogin('a'); setTasks(copy); }); act(cancel); expect(store.getState().tasks).toEqual([task()]);
        });
        it('古い完了Undoで新しく作り直した完了待機を取り消さない', () => {
            mount(); act(action(completeLabel)); const old = undo(); act(action(uncompleteLabel)); act(action(completeLabel)); const current = store.getState().pendingCompletions[0];
            act(old); expect(store.getState().pendingCompletions[0]).toBe(current); expect(store.getState().tasks[0].completed).toBe(true);
            act(undo()); expect(store.getState().tasks[0].completed).toBe(false);
        });
        it.each(['switch', 'logout', 'roundtrip', 'unmount'])('%s後の旧行操作を拒否する', async (kind) => {
            mount(); const complete = action(completeLabel); const duplicate = action(duplicateLabel); const edit = action(editLabel);
            await act(async () => { await transition(kind); setTasks([task()]); complete(); duplicate(); edit(); });
            expect(store.getState().tasks).toEqual([task()]); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.undo).not.toHaveBeenCalled();
        });
        it('再描画前のアカウント切替でも旧行操作を拒否する', async () => {
            mount(); const complete = action(completeLabel); const duplicate = action(duplicateLabel);
            await act(async () => { const pending = notifyLogin('b'); setTasks([task()]); complete(); duplicate(); await pending; });
            expect(store.getState().tasks).toEqual([task()]); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it.each(['changed', 'deleted', 'replaced', 'subtasks'])('%sになった古い行を完了・複製しない', (kind) => {
            mount(); const complete = action(completeLabel); const duplicate = action(duplicateLabel); const target = task();
            if (kind === 'changed') target.name = '同期後'; if (kind === 'replaced') target.createdAt = '2026-10-21T00:00:00Z';
            if (kind === 'subtasks') target.subtasks.push({ id: 'child', name: '子', completed: false, completedAt: null, createdAt: target.createdAt });
            const next = kind === 'deleted' ? [] : [target]; act(() => { setTasks(next); complete(); duplicate(); });
            expect(store.getState().tasks).toEqual(next); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.undo).not.toHaveBeenCalled();
        });
        it('認証切替後の複製Undoは同IDの新データを消さない', async () => {
            mount(); act(action(duplicateLabel)); const cancel = undo(); const copy = structuredClone(store.getState().tasks);
            await act(async () => { await notifyLogin('b'); setTasks(copy); cancel(); }); expect(store.getState().tasks).toEqual(copy); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it('Undoは同じ認証なら画面離脱後も対象を限定して有効なまま', () => {
            mount(); act(action(duplicateLabel)); const cancel = undo(); unmount(); act(cancel);
            expect(store.getState().tasks).toEqual([task()]);
        });
        if (platform === 'native') {
            it('タブ離脱後に戻っても旧行は無効、新しい行は操作できる', () => {
                mount(); const complete = action(completeLabel); const duplicate = action(duplicateLabel);
                act(() => { [...mocks.blur].forEach((callback) => callback()); [...mocks.focus].forEach((callback) => callback()); complete(); duplicate(); });
                expect(store.getState().tasks).toEqual([task()]); act(action(completeLabel)); expect(store.getState().tasks[0].completed).toBe(true);
            });
            it('復元前のタップは完了・複製もUndo表示もしない', () => {
                useMobileTaskStore.setState({ hasHydrated: false }); mount(); act(action(completeLabel)); act(action(duplicateLabel));
                expect(store.getState().tasks).toEqual([task()]); expect(mocks.undo).not.toHaveBeenCalled(); expect(mocks.alert).not.toHaveBeenCalled();
            });
        }
    });
    describe(`${platform}: current CSV and filters`, () => {
        it('前の描画のCSVボタンでも現在の全タスクを書き出す', async () => {
            mount(); const save = action(csvLabel); act(() => { setTasks([{ ...task(), name: '最新の名前' }, { ...task(), id: 'two', name: '別のタスク' }]); });
            await act(async () => { save(); await Promise.resolve(); });
            expect(exportCount()).toBe(1); expect(csvText()).toContain('最新の名前'); expect(csvText()).toContain('別のタスク'); expect(csvText()).not.toContain('対象');
            if (platform === 'web') expect(mocks.revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:fixture');
        });
        it.each(['switch', 'logout', 'roundtrip', 'unmount'])('%s後の古いCSV操作は開始しない', async (kind) => {
            mount(); const save = action(csvLabel); await act(async () => { await transition(kind); setTasks([task()]); save(); }); expect(exportCount()).toBe(0);
        });
        it('同一ユーザー通知ではCSV操作を継続できる', async () => {
            mount(); const save = action(csvLabel); await act(async () => { await notifyLogin('a'); save(); await Promise.resolve(); }); expect(exportCount()).toBe(1);
        });
        it('検索・期限・優先度・タグを切替時にリセットし、旧入力を拒否する', async () => {
            mount();
            const old = platform === 'web' ? { search: mocks.filters.onSearchQueryChange as (text: string) => void, due: mocks.filters.onDueFilterChange as (text: string) => void,
                priority: mocks.filters.onPriorityFilterChange as (text: string) => void, tag: mocks.filters.onToggleTag as (text: string) => void }
                : { search: mocks.changes.get('タスクを検索')!, due: action('期限フィルター 今日まで'), priority: action('優先度フィルター 高'), tag: action('タグ絞り込み tag') };
            act(() => { old.search('対象'); old.due('dueSoon'); old.priority('high'); old.tag('tag'); });
            await act(async () => { await notifyLogin('b'); old.search('復活させない'); old.due('dueSoon'); old.priority('high'); old.tag('tag'); });
            if (platform === 'web') { expect(mocks.filters.searchQuery).toBe(''); expect(mocks.filters.dueFilter).toBe('all'); expect(mocks.filters.priorityFilter).toBe('all'); expect(mocks.filters.selectedTags).toEqual([]); }
            else { expect(host.querySelector<HTMLInputElement>('[aria-label="タスクを検索"]')!.value).toBe(''); expect(host.querySelector('[aria-label="期限フィルター すべて"]')!.getAttribute('aria-pressed')).toBe('true'); expect(host.querySelector('[aria-label="タグ絞り込み tag"]')!.getAttribute('aria-pressed')).toBe('false'); }
        });
        it('同一ユーザー通知・同値pullでは検索を保持する', async () => {
            mount(); const search = platform === 'web' ? mocks.filters.onSearchQueryChange as (text: string) => void : mocks.changes.get('タスクを検索')!;
            act(() => search('対象')); await act(async () => { await notifyLogin('a'); setTasks([task()]); });
            expect(platform === 'web' ? mocks.filters.searchQuery : host.querySelector<HTMLInputElement>('[aria-label="タスクを検索"]')!.value).toBe('対象');
        });
        if (platform === 'web') it('書き出し失敗でもURLを解放し、再試行できる', () => {
            mount(); mocks.click.mockImplementationOnce(() => { throw new Error('fixture'); }); act(action(csvLabel));
            expect(host.querySelector('[role="alert"]')!.textContent).toContain('CSVを書き出せませんでした'); expect(mocks.revokeUrl).toHaveBeenCalledOnce();
            act(action(csvLabel)); expect(mocks.click).toHaveBeenCalledTimes(2); expect(host.querySelector('[role="alert"]')).toBeNull();
        });
        if (platform === 'native') {
            it('共有中の連打を拒否し、同じ画面の失敗だけ通知して再試行できる', async () => {
                const request = deferred(); mocks.share.mockReturnValueOnce(request.promise); mount(); const share = action(csvLabel);
                act(() => { share(); share(); }); expect(mocks.share).toHaveBeenCalledOnce();
                await act(async () => { request.reject(); await Promise.resolve(); }); expect(mocks.alert).toHaveBeenCalledExactlyOnceWith('共有できませんでした', 'もう一度お試しください。');
                await act(async () => { action(csvLabel)(); await Promise.resolve(); }); expect(mocks.share).toHaveBeenCalledTimes(2);
            });
            it('旧共有の遅れた失敗は別アカウントの共有/通知に干渉しない', async () => {
                const old = deferred(); const current = deferred(); mocks.share.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise); mount(); act(action(csvLabel));
                await act(async () => notifyLogin('b')); act(action(csvLabel)); expect(mocks.share).toHaveBeenCalledTimes(2);
                await act(async () => { old.reject(); await Promise.resolve(); }); act(action(csvLabel)); expect(mocks.share).toHaveBeenCalledTimes(2); expect(mocks.alert).not.toHaveBeenCalled();
                await act(async () => { current.resolve(); await Promise.resolve(); }); await act(async () => { action(csvLabel)(); await Promise.resolve(); }); expect(mocks.share).toHaveBeenCalledTimes(3);
            });
            it('タブ離脱後の旧共有失敗は通知せず、検索もリセットする', async () => {
                const pending = deferred(); mocks.share.mockReturnValueOnce(pending.promise); mount(); act(() => mocks.changes.get('タスクを検索')!('対象')); act(action(csvLabel));
                act(() => { [...mocks.blur].forEach((callback) => callback()); [...mocks.focus].forEach((callback) => callback()); });
                await act(async () => { pending.reject(); await Promise.resolve(); }); expect(mocks.alert).not.toHaveBeenCalled(); expect(host.querySelector<HTMLInputElement>('[aria-label="タスクを検索"]')!.value).toBe('');
            });
        }
    });
}
