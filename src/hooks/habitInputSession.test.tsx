import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import type { Habit, HabitDailyRecord, RestDay } from '@life-quest/core/habits';
import { useHabitStore } from '../stores/useHabitStore';
import { useMobileHabitStore } from '../../apps/mobile/src/stores/useMobileHabitStore';
import { HabitsPage } from '../pages/HabitsPage';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(async (..._args: unknown[]) => true), alert: vi.fn(),
    restConfirm: () => {}, restCancel: () => {}, nativeAdd: () => {}, nativeCancel: () => {},
    presses: new Map<string, () => void>(), blur: () => {}, focus: () => {},
    capture: (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const props = value as Record<string, unknown>;
        const label = props['aria-label'];
        if (typeof label === 'string' && typeof props.onClick === 'function') mocks.presses.set(label, props.onClick as () => void);
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
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../../apps/mobile/src/theme/usePalette', async () => {
    const { DARK_THEME } = await import('@life-quest/core/designTokens'); return { usePalette: () => ({ palette: DARK_THEME }) };
});
vi.mock('../components/ui/ConfirmDialog', async (original) => {
    const { ConfirmDialog } = await original<typeof import('../components/ui/ConfirmDialog')>();
    return { ConfirmDialog: (props: Parameters<typeof ConfirmDialog>[0]) => {
        if (props.open) { mocks.restConfirm = props.onConfirm; mocks.restCancel = props.onClose; }
        return createElement(ConfirmDialog, props);
    } };
});
vi.mock('../../apps/mobile/src/components/DailyScreenUI', async (original) => {
    const module = await original<typeof import('../../apps/mobile/src/components/DailyScreenUI')>();
    return { ...module, FormActions: (props: Parameters<typeof module.FormActions>[0]) => {
        mocks.nativeAdd = props.onSave; mocks.nativeCancel = props.onCancel;
        return createElement(module.FormActions, props);
    } };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }), useFocusEffect: (setup: () => (() => void) | undefined) => {
    useEffect(() => {
        let cleanup = setup(); mocks.blur = () => { cleanup?.(); cleanup = undefined; }; mocks.focus = () => { cleanup = setup(); };
        return () => cleanup?.();
    }, [setup]);
} }));
vi.mock('lucide-react-native', () => import('lucide-react'));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children?: ReactNode }) => createElement('div', {}, children) }));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string };
    const box = ({ children }: Props) => createElement('div', {}, children);
    return { Alert: { alert: mocks.alert }, View: box, ScrollView: box, KeyboardAvoidingView: box, Modal: box,
        Text: ({ children }: Props) => createElement('span', {}, children),
        TextInput: ({ value, accessibilityLabel, placeholder, onChangeText }: { value?: string; accessibilityLabel?: string; placeholder?: string; onChangeText?: (value: string) => void }) =>
            createElement('input', { value, placeholder, 'aria-label': accessibilityLabel, onChange: (event) => onChangeText?.(event.target.value) }),
        Pressable: ({ children, onPress, disabled, accessibilityLabel }: Props) => {
            if (accessibilityLabel && onPress) mocks.presses.set(accessibilityLabel, onPress);
            return createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children);
        },
        SectionList: ({ ListHeaderComponent, sections, renderItem }: { ListHeaderComponent: ReactNode; sections: { data: { habit: Habit }[]; category: unknown }[];
            renderItem: (value: { item: { habit: Habit }; section: unknown }) => ReactNode }) => {
            const rows = sections.flatMap((section) => section.data.map((item) =>
                createElement('div', { key: item.habit.id }, renderItem({ item, section }))));
            return createElement('div', {}, createElement('div', { key: 'header' }, ListHeaderComponent), rows);
        },
        Keyboard: { dismiss: vi.fn() }, Platform: { OS: 'ios' }, StyleSheet: { create: <T,>(value: T) => value },
    };
});
const nativeModule = '../../apps/mobile/src/screens/HabitsScreen';
const { default: HabitsScreen } = await import(nativeModule);
const DATE = '2026-10-19';
const habit = (): Habit => ({ id: 'one', name: '読書', categoryId: 'study', createdAt: '2026-10-18T00:00:00Z' });
const habits = () => [habit(), { ...habit(), id: 'two', name: '運動' }];
const record = (): HabitDailyRecord => ({ habitId: 'one', date: DATE, completed: true, memo: '' });
let host: HTMLDivElement; let root: Root | null;
function button(label: string) {
    const element = [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent === label);
    expect(element, label).toBeDefined(); return element!;
}
function press(label: string) { act(() => button(label).click()); }
function input(placeholder: string, value: string) {
    const field = host.querySelector<HTMLInputElement>(`[placeholder="${placeholder}"]`)!; expect(field).toBeTruthy();
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
function unmount() { if (root) act(() => { root!.unmount(); root = null; }); }
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.useFakeTimers(); vi.setSystemTime(new Date(`${DATE}T12:00:00+09:00`));
    vi.clearAllMocks(); mocks.presses.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
    useHabitStore.setState({ habits: habits(), dailyRecords: [], restDays: [], allCompleteRewardDates: [] });
    useMobileHabitStore.setState({ habits: habits(), records: [], restDays: [], rewardEligibleDates: [], hasHydrated: true });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { unmount(); host.remove(); resetAuthLifecycleHooks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

for (const platform of ['web', 'native'] as const) {
    const store = platform === 'web' ? useHabitStore : useMobileHabitStore;
    const setState = (partial: { habits?: Habit[]; restDays?: RestDay[] }) => {
        if (platform === 'web') useHabitStore.setState(partial); else useMobileHabitStore.setState(partial);
    };
    const setRecords = (records: HabitDailyRecord[]) => { if (platform === 'web') useHabitStore.setState({ dailyRecords: records }); else useMobileHabitStore.setState({ records }); };
    const records = () => platform === 'web' ? useHabitStore.getState().dailyRecords : useMobileHabitStore.getState().records;
    const seed = () => { if (platform === 'web') useHabitStore.setState({ habits: habits() }); else useMobileHabitStore.setState({ habits: habits() }); setRecords([record()]); };
    const mount = () => act(() => root!.render(createElement(StrictMode, {}, createElement(MemoryRouter, {}, platform === 'web' ? createElement(HabitsPage) : createElement(HabitsScreen)))));
    const savedMemo = () => platform === 'web' ? (() => { const save = button('保存'); return () => save.click(); })() : mocks.presses.get('習慣メモを保存')!;
    const saveMemo = () => press(platform === 'web' ? '保存' : '習慣メモを保存');
    const savedAdd = () => platform === 'web' ? (() => { const form = host.querySelector('form')!; return () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); })() : mocks.nativeAdd;
    const rest = () => {
        press('今日をお休みにする');
        if (platform === 'web') return { confirm: mocks.restConfirm, cancel: mocks.restCancel };
        const actions = mocks.alert.mock.calls.at(-1)![2];
        return { confirm: actions.find((item: { text: string }) => item.text === 'お休みにする').onPress as () => void,
            cancel: actions.find((item: { text: string }) => item.text === 'キャンセル').onPress as () => void };
    };
    const openMemo = async () => { press(platform === 'web' ? '習慣「読書」を達成にする' : '読書を達成にする'); await act(async () => { await Promise.resolve(); }); mocks.enqueue.mockClear(); };
    const transition = async (kind: string) => {
        if (kind === 'switch') await notifyLogin('b');
        if (kind === 'logout') await notifyLogout();
        if (kind === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); }
        if (kind === 'unmount') unmount();
    };
    describe(`${platform}: habit input ownership`, () => {
        it('追加は一度だけ保存・送信する', () => {
            mount(); press('新しい習慣を追加'); input('新しい習慣を入力...', '新しい習慣'); const add = savedAdd(); act(() => { add(); add(); });
            expect(store.getState().habits.filter((item) => item.name === '新しい習慣')).toHaveLength(1);
            expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it.each(['switch', 'logout', 'roundtrip', 'unmount'])('%sで追加下書きを破棄し旧送信を拒否する', async (kind) => {
            mount(); press('新しい習慣を追加'); input('新しい習慣を入力...', '古い下書き'); const add = savedAdd();
            await act(async () => { await transition(kind); add(); });
            expect(store.getState().habits).toHaveLength(2); expect(mocks.enqueue).not.toHaveBeenCalled();
            expect(host.querySelector('[placeholder="新しい習慣を入力..."]')).toBeNull();
        });
        it('同一ユーザー通知では追加入力を維持する', async () => {
            mount(); press('新しい習慣を追加'); input('新しい習慣を入力...', '保持');
            await act(async () => notifyLogin('a')); act(savedAdd());
            expect(store.getState().habits.some((item) => item.name === '保持')).toBe(true);
        });
        it('メモの通常保存は達成状態と日付を保ち一度だけ送信する', async () => {
            mount(); await openMemo(); input('今日の一言...', '保存メモ'); const save = savedMemo(); act(() => { save(); save(); });
            expect(records()).toEqual([{ ...record(), memo: '保存メモ' }]); expect(mocks.enqueue).toHaveBeenCalledOnce();
            expect(mocks.enqueue).toHaveBeenCalledWith('set_habit_log', { p_habit_id: 'one', p_date: DATE, p_completed: true, p_memo: '保存メモ' }, expect.anything());
        });
        it.each(['switch', 'logout', 'roundtrip', 'unmount'])('%s後のメモ保存は同IDの記録に触れない', async (kind) => {
            mount(); await openMemo(); input('今日の一言...', '旧メモ'); const save = savedMemo();
            await act(async () => { await transition(kind); seed(); save(); });
            expect(records()).toEqual([record()]); expect(mocks.enqueue).not.toHaveBeenCalled();
            expect(host.querySelector('[placeholder="今日の一言..."]')).toBeNull();
        });
        it('再描画前の切替でも古いメモを保存しない', async () => {
            mount(); await openMemo(); input('今日の一言...', '旧メモ'); const save = savedMemo();
            await act(async () => { const pending = notifyLogin('b'); seed(); save(); await pending; });
            expect(records()).toEqual([record()]); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('同一ユーザー通知と同値pullではメモを維持する', async () => {
            mount(); await openMemo(); input('今日の一言...', '入力を保持');
            await act(async () => { await notifyLogin('a'); seed(); }); saveMemo();
            expect(records()[0].memo).toBe('入力を保持'); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it.each(['deleted', 'replaced', 'record', 'uncompleted', 'missing-record'])('%sならメモを上書きしない', async (change) => {
            mount(); await openMemo(); input('今日の一言...', '手元のメモ');
            act(() => {
                if (change === 'deleted' || change === 'replaced') {
                    const current = change === 'deleted' ? [] : [{ ...habit(), createdAt: '2026-10-19T01:00:00Z' }];
                    if (platform === 'web') useHabitStore.setState({ habits: current }); else useMobileHabitStore.setState({ habits: current });
                }
                if (change === 'record') setRecords([{ ...record(), memo: '同期メモ' }]);
                if (change === 'uncompleted') setRecords([{ ...record(), completed: false }]);
                if (change === 'missing-record') setRecords([]);
            });
            const before = structuredClone(records()); saveMemo();
            expect(records()).toEqual(before); expect(mocks.enqueue).not.toHaveBeenCalled();
            expect(host.textContent).toContain('この習慣または達成記録は変更されています');
            expect(host.querySelector<HTMLInputElement>('[placeholder="今日の一言..."]')!.value).toBe('手元のメモ');
        });
        it('日付が変わったメモを翌日にも前日にも書き込まない', async () => {
            mount(); await openMemo(); input('今日の一言...', '前日の入力'); vi.setSystemTime(new Date('2026-10-20T00:01:00+09:00')); saveMemo();
            expect(records()).toEqual([record()]); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(host.textContent).toContain('日付が変わりました');
        });
        it('日付変更後の最初のタップは最新表示を案内し、確認後のタップだけ翌日に記録する', async () => {
            mount(); vi.setSystemTime(new Date('2026-10-20T00:01:00+09:00')); await openMemo();
            expect(records()).toEqual([]); expect(host.textContent).toContain('日付または習慣の内容が変わりました');
            await openMemo(); input('今日の一言...', '翌日の入力'); saveMemo();
            expect(records()).toEqual([{ ...record(), date: '2026-10-20', memo: '翌日の入力' }]);
        });
        it('お休み確認は一度だけ同じ日に保存する', () => {
            mount(); const request = rest(); act(() => { request.confirm(); request.confirm(); });
            expect(store.getState().restDays).toEqual([{ date: DATE, isRest: true }]); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it('同一ユーザー通知でもお休みの確認を維持する', async () => {
            mount(); const request = rest(); await act(async () => notifyLogin('a')); act(request.confirm);
            expect(store.getState().restDays).toEqual([{ date: DATE, isRest: true }]); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it.each(['switch', 'logout', 'roundtrip', 'unmount'])('%s後の古いお休み確認は保存しない', async (kind) => {
            mount(); const request = rest(); await act(async () => { await transition(kind); request.confirm(); });
            expect(store.getState().restDays).toEqual([]); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('お休みの取消・再確認後に古い確定/取消が新しい確認へ干渉しない', () => {
            mount(); const old = rest(); act(old.cancel); const current = rest(); act(() => { old.confirm(); old.cancel(); });
            expect(mocks.enqueue).not.toHaveBeenCalled(); act(current.confirm); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it('日付変更後のお休み確認はどちらの日にも保存しない', () => {
            mount(); const request = rest(); vi.setSystemTime(new Date('2026-10-20T00:01:00+09:00')); act(request.confirm);
            expect(store.getState().restDays).toEqual([]); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        if (platform === 'native') it('タブ離脱・復帰後も旧メモとAlertを受け付けない', async () => {
            mount(); const request = rest(); await openMemo(); input('今日の一言...', '離脱前'); const save = savedMemo();
            act(() => { mocks.blur(); mocks.focus(); save(); request.confirm(); });
            expect(mocks.enqueue).not.toHaveBeenCalled(); expect(records()).toEqual([record()]); expect(store.getState().restDays).toEqual([]);
            expect(host.querySelector('[placeholder="今日の一言..."]')).toBeNull();
        });
        if (platform === 'native') it('スキップ後の旧メモ保存が次のメモへ干渉しない', async () => {
            mount(); await openMemo(); input('今日の一言...', '古い入力'); const save = savedMemo();
            press('習慣メモをスキップ'); press('読書を未達成にする'); await openMemo(); input('今日の一言...', '現在の入力');
            act(save); expect(mocks.enqueue).not.toHaveBeenCalled(); saveMemo(); expect(records()[0].memo).toBe('現在の入力');
        });
    });
    describe(`${platform}: habit row actions`, () => {
        const completeLabel = platform === 'web' ? '習慣「読書」を達成にする' : '読書を達成にする';
        const reopenLabel = platform === 'web' ? '習慣「読書」を未達成にする' : '読書を未達成にする';
        const callback = (label: string) => { const action = mocks.presses.get(label); expect(action, label).toBeDefined(); return action!; };
        const flush = async () => act(async () => { await Promise.resolve(); });
        it('同じ達成callbackの再実行は反転せずメモも再生成しない', async () => {
            mount(); const complete = callback(completeLabel); act(() => { complete(); complete(); }); await flush();
            expect(records()).toEqual([record()]); expect(mocks.enqueue).toHaveBeenCalledOnce();
            input('今日の一言...', '入力を保持'); act(complete);
            expect(host.querySelector<HTMLInputElement>('[placeholder="今日の一言..."]')!.value).toBe('入力を保持');
        });
        it('通常の未達成化は一度だけ送信し、保存済みメモを保つ', async () => {
            setRecords([{ ...record(), memo: '記録済み' }]); mount(); const reopen = callback(reopenLabel);
            act(() => { reopen(); reopen(); }); await flush();
            expect(records()).toEqual([{ ...record(), completed: false, memo: '記録済み' }]); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it.each(['switch', 'logout', 'roundtrip', 'unmount'])('%s後の旧達成・画面開始・カテゴリ操作を拒否する', async (kind) => {
            const both = [habit(), { ...habit(), id: 'two', name: '運動', categoryId: 'health' }]; setState({ habits: both }); mount();
            const complete = callback(completeLabel); const add = callback('新しい習慣を追加'); const restAction = callback('今日をお休みにする');
            const history = callback('「読書」の達成履歴を表示'); const remove = callback('「読書」を削除'); const filter = callback('カテゴリ: 健康');
            await act(async () => { await transition(kind); setState({ habits: both }); setRecords([]); complete(); add(); restAction(); history(); remove(); filter(); });
            expect(records()).toEqual([]); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.alert).not.toHaveBeenCalled();
            expect(host.querySelector('[placeholder="新しい習慣を入力..."]')).toBeNull();
            expect(host.textContent).not.toContain('過去180日'); expect(host.textContent).not.toContain('本当に今日はお休み');
            expect(host.textContent).not.toContain('この操作は取り消せません');
            if (kind !== 'unmount') expect(button(completeLabel)).toBeTruthy();
        });
        it('描画前の直接アカウント切替でも達成を拒否する', async () => {
            mount(); const complete = callback(completeLabel);
            await act(async () => { const pending = notifyLogin('b'); setRecords([]); complete(); await pending; });
            expect(records()).toEqual([]); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it.each(['name', 'categoryId', 'createdAt', 'missing', 'record', 'memo', 'removed-record'])('%s変更後の古い達成を拒否する', async (kind) => {
            if (kind === 'removed-record') setRecords([{ ...record(), completed: false }]);
            mount(); const complete = callback(completeLabel); const changed = habit();
            act(() => {
                if (kind === 'name') changed.name = '変更後'; if (kind === 'categoryId') changed.categoryId = 'health';
                if (kind === 'createdAt') changed.createdAt = '2026-10-19T00:00:00Z';
                setState({ habits: kind === 'missing' ? [] : [changed, { ...habit(), id: 'two', name: '運動' }] });
                if (kind === 'record') setRecords([record()]); if (kind === 'memo') setRecords([{ ...record(), completed: false, memo: '別の編集' }]);
                if (kind === 'removed-record') setRecords([]);
                complete();
            }); await flush();
            expect(records()).toEqual(kind === 'record' ? [record()] : kind === 'memo' ? [{ ...record(), completed: false, memo: '別の編集' }] : []);
            expect(mocks.enqueue).not.toHaveBeenCalled(); expect(host.textContent).toContain('日付または習慣の内容が変わりました');
        });
        it('同値pull・同一ユーザー通知・他習慣の更新では旧行も通常どおり達成できる', async () => {
            mount(); const complete = callback(completeLabel);
            await act(async () => { await notifyLogin('a'); setState({ habits: structuredClone(habits()) }); setRecords([{ ...record(), habitId: 'two', completed: false, memo: '別の習慣の更新' }]); complete(); }); await flush();
            expect(records().find((entry) => entry.habitId === 'one')?.completed).toBe(true); expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it('同日のお休み設定後も達成操作を維持する', async () => {
            mount(); const complete = callback(completeLabel); act(() => { setState({ restDays: [{ date: DATE, isRest: true }] }); complete(); }); await flush();
            expect(records()).toEqual([record()]);
        });
        it('カテゴリ選択は通常操作・同一ユーザー通知・同値pullで維持する', async () => {
            setState({ habits: [habit(), { ...habit(), id: 'two', name: '運動', categoryId: 'health' }] }); mount();
            act(callback('カテゴリ: 健康')); expect(host.querySelector(`[aria-label='${completeLabel}']`)).toBeNull();
            await act(async () => { await notifyLogin('a'); setState({ habits: structuredClone(store.getState().habits) }); });
            expect(host.querySelector(`[aria-label='${completeLabel}']`)).toBeNull();
            act(callback('カテゴリ: すべて')); expect(button(completeLabel)).toBeTruthy();
        });
        it('アカウント切替ではカテゴリ選択をリセットする', async () => {
            const both = [habit(), { ...habit(), id: 'two', name: '運動', categoryId: 'health' }]; setState({ habits: both }); mount();
            act(callback('カテゴリ: 健康')); await act(async () => { await notifyLogin('b'); setState({ habits: both }); });
            expect(button(completeLabel)).toBeTruthy();
        });
        it('選択カテゴリが削除でなくなったら全件へ戻り、再追加でも勝手に絞らない', () => {
            const both = [habit(), { ...habit(), id: 'two', name: '運動', categoryId: 'health' }]; setState({ habits: both }); mount();
            act(callback('カテゴリ: 健康')); act(() => setState({ habits: [habit()] })); expect(button(completeLabel)).toBeTruthy();
            act(() => setState({ habits: both })); expect(button(completeLabel)).toBeTruthy();
        });
        if (platform === 'native') {
            it('タブ復帰後の旧行は拒否、新しい行は達成できる', async () => {
                mount(); const complete = callback(completeLabel); const add = callback('新しい習慣を追加'); const restAction = callback('今日をお休みにする');
                const history = callback('「読書」の達成履歴を表示'); const remove = callback('「読書」を削除');
                act(() => { mocks.blur(); mocks.focus(); complete(); add(); restAction(); history(); remove(); });
                expect(records()).toEqual([]); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.alert).not.toHaveBeenCalled();
                expect(host.textContent).not.toContain('過去180日'); expect(host.querySelector('[placeholder="新しい習慣を入力..."]')).toBeNull();
                act(callback(completeLabel)); await flush(); expect(records()).toEqual([record()]);
            });
            it('読込前の直接callbackでも達成・メモ表示をしない', () => {
                useMobileHabitStore.setState({ hasHydrated: false }); mount(); act(callback(completeLabel));
                expect(records()).toEqual([]); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(host.querySelector('[placeholder="今日の一言..."]')).toBeNull();
            });
            it('タブ復帰でカテゴリをリセットする', () => {
                setState({ habits: [habit(), { ...habit(), id: 'two', name: '運動', categoryId: 'health' }] }); mount();
                act(callback('カテゴリ: 健康')); act(() => { mocks.blur(); mocks.focus(); }); expect(button(completeLabel)).toBeTruthy();
            });
        }
    });
}
