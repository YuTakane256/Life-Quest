import { act, createElement, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTask } from '@life-quest/core/tasks';
import { useMobileTaskStore } from '../../apps/mobile/src/stores/useMobileTaskStore';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(async () => true) }));
vi.mock('../../apps/mobile/src/platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isCloudOutboxActive: () => false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../../apps/mobile/src/hooks/useTaskUndoToast', () => ({ useTaskUndoToast: () => ({ toast: null, showUndo: vi.fn() }) }));
vi.mock('../../apps/mobile/src/components/TaskBottomActions', () => ({ TaskBottomActions: () => null }));
vi.mock('../../apps/mobile/src/theme/usePalette', async () => {
    const { DARK_THEME } = await import('@life-quest/core/designTokens'); return { usePalette: () => ({ palette: DARK_THEME }) };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }), useFocusEffect: (setup: () => (() => void) | undefined) => useEffect(setup, [setup]) }));
vi.mock('lucide-react-native', () => import('lucide-react'));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children?: ReactNode }) => createElement('div', {}, children) }));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string };
    const box = ({ children }: Props) => createElement('div', {}, children);
    return { AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) }, Alert: { alert: vi.fn() }, View: box, ScrollView: box, KeyboardAvoidingView: box, Modal: box,
        Text: ({ children }: Props) => createElement('span', {}, children),
        TextInput: ({ value, accessibilityLabel, onChangeText }: { value?: string; accessibilityLabel?: string; onChangeText?: (value: string) => void }) =>
            createElement('input', { value, 'aria-label': accessibilityLabel, onChange: (event) => onChangeText?.(event.target.value) }),
        Pressable: ({ children, onPress, disabled, accessibilityLabel }: Props) => createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
        FlatList: ({ ListHeaderComponent, data, renderItem }: { ListHeaderComponent: ReactNode; data: { id: string }[]; renderItem: (value: { item: { id: string } }) => ReactNode }) =>
            createElement('div', {}, ListHeaderComponent, ...data.map((item) => createElement('div', { key: item.id }, renderItem({ item })))),
        Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove: vi.fn() }) }, Platform: { OS: 'ios' }, Share: { share: vi.fn(async () => {}) }, StyleSheet: { create: <T,>(value: T) => value },
    };
});
// Avoid pulling Native image declarations into the Web TypeScript program.
const nativeModule = '../../apps/mobile/src/screens/TasksScreen';
const { default: TasksScreen } = await import(nativeModule);
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useMobileTaskStore.setState({ tasks: [createTask({ id: 'edited', name: '編集対象', recurrence: 'daily', now: '2026-10-19T00:00:00.000Z' })!], pendingCompletions: [], hasHydrated: true });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    act(() => root.render(createElement(TasksScreen)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function press(label: string) {
    const button = [...host.querySelectorAll('button')].filter((element) => element.getAttribute('aria-label') === label || element.textContent === label).at(-1);
    expect(button, label).toBeDefined(); act(() => button!.click());
}
describe('Mobileの実タスク編集フォーム', () => {
    it.each([['none', 'なし'], ['daily', '毎日'], ['weekly', '毎週'], ['monthly', '毎月']] as const)('%sへ変更して保存・再編集・送信する', (recurrence, label) => {
        press('編集対象を編集'); press('繰り返し'); press(label); press('更新');
        expect(useMobileTaskStore.getState().tasks[0]).toMatchObject({ id: 'edited', recurrence, completed: false });
        expect(mocks.enqueue).toHaveBeenCalledWith('upsert_task', expect.objectContaining({ p_id: 'edited', p_recurrence: recurrence }), expect.any(Object));
        press('編集対象を編集');
        expect(host.querySelector('button[aria-label="繰り返し"]')?.textContent).toBe(label);
        expect(host.textContent).not.toContain('作成時の設定');
    });
    it('設定を選んでもキャンセルした場合は保存・送信しない', () => {
        press('編集対象を編集'); press('繰り返し'); press('毎月'); press('キャンセル');
        expect(useMobileTaskStore.getState().tasks[0].recurrence).toBe('daily');
        expect(mocks.enqueue).not.toHaveBeenCalled();
        press('編集対象を編集');
        expect(host.querySelector('button[aria-label="繰り返し"]')?.textContent).toBe('毎日');
    });
});
