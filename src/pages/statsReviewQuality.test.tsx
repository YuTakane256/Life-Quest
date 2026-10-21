import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HabitDayActivity } from '@life-quest/core/stats';
const mocks = vi.hoisted(() => ({
    today: '2026-08-10', logs: { taskXpLog: {} as Record<string, number>, habitLog: {} as Record<string, HabitDayActivity> },
    game: { character: { totalXp: 60 }, battle: { maxClearedStage: 0 }, battleProgress: { maxClearedStage: 0 }, equipment: [] },
    title: { activeTitle: null, setActiveTitle: () => {} },
    press: new Map<string, () => void>(), styles: new Map<string, unknown>(), focused: true,
}));
vi.mock('../stores/useStatsStore', () => ({ useStatsStore: () => mocks.logs }));
vi.mock('../stores/useGameStore', () => ({ useGameStore: (selector: (state: unknown) => unknown) => selector(mocks.game) }));
vi.mock('../stores/useTitleStore', () => ({ useTitleStore: (selector: (state: unknown) => unknown) => selector(mocks.title) }));
vi.mock('../hooks/useJstToday', () => ({ useJstToday: () => mocks.today }));
vi.mock('../../apps/mobile/src/hooks/useJstToday', () => ({ useJstToday: () => mocks.today }));
vi.mock('../../apps/mobile/src/stores/useMobileStatsStore', () => ({ useMobileStatsStore: (selector: (state: unknown) => unknown) => selector(mocks.logs) }));
vi.mock('../../apps/mobile/src/stores/useMobileGameStore', () => ({ useMobileGameStore: (selector: (state: unknown) => unknown) => selector(mocks.game) }));
vi.mock('../../apps/mobile/src/stores/useMobileTitleStore', () => ({ useMobileTitleStore: (selector: (state: unknown) => unknown) => selector(mocks.title) }));
vi.mock('../../apps/mobile/src/theme/usePalette', async () => { const { LIGHT_THEME } = await import('@life-quest/core/designTokens'); return { usePalette: () => ({ palette: LIGHT_THEME }) }; });
vi.mock('expo-router', () => ({ useFocusEffect: (setup: () => void | (() => void)) => {
    const focused = mocks.focused; useEffect(() => focused ? setup() : undefined, [focused, setup]);
} }));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; testID?: string; accessibilityLabel?: string; accessibilityRole?: string; disabled?: boolean; onPress?: () => void; style?: unknown; visible?: boolean };
    const View = ({ children, testID }: Props) => createElement('div', { 'data-testid': testID }, children);
    return { View, ScrollView: View, StyleSheet: { create: <T,>(value: T) => value },
        Modal: ({ visible, children }: Props) => visible ? createElement('div', { role: 'dialog' }, children) : null,
        Text: ({ children, testID }: Props) => createElement('span', { 'data-testid': testID }, children),
        Pressable: ({ children, accessibilityLabel, onPress, disabled, style }: Props) => {
            if (accessibilityLabel) { mocks.press.set(accessibilityLabel, onPress!); mocks.styles.set(accessibilityLabel, style); }
            return createElement('button', { 'aria-label': accessibilityLabel, disabled, onClick: onPress }, children);
        },
    };
});
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));
import { StatsPage } from './StatsPage';
import StatsScreen from '../../apps/mobile/src/screens/StatsScreen';
let root: Root; let host: HTMLDivElement;
const render = (mobile: boolean) => act(() => root.render(createElement(StrictMode, {}, createElement(mobile ? StatsScreen : StatsPage))));
const button = (name: string) => [...host.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === name || node.textContent === name)!;
const press = (name: string) => act(() => button(name).click());
const detail = () => host.querySelector('[aria-label="日別統計"], [data-testid="stats-day-detail"]')!.textContent;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.today = '2026-08-10'; mocks.focused = true; mocks.press.clear(); mocks.styles.clear();
    mocks.logs = { taskXpLog: { '2026-08-09': 20, '2026-08-10': 30, '2026-01-01': 999 }, habitLog: { '2026-08-10': { count: 2, allComplete: true } } };
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe.each([false, true])('日別振り返り mobile=%s', (mobile) => {
    const habits = () => press(mobile ? '統計を習慣に切り替える' : '習慣');
    it('今日を含む119日と集計を表示し、モード変更で旧XPを残さない', () => {
        render(mobile); expect(host.textContent).toContain('過去119日'); expect(detail()).toBe('2026-08-10: 30 XP');
        expect(host.textContent).toContain('合計XP'); expect(host.textContent).not.toContain('1,049');
        habits(); expect(detail()).toBe('2026-08-10: 2個達成 (全達成!)'); expect(host.textContent).toContain('合計達成数');
    });
    it('前後日・今日・欠損日から復帰でき、最新ログ値で詳細を更新する', () => {
        render(mobile); expect(button('次の日').disabled).toBe(true);
        press('前の日'); expect(detail()).toBe('2026-08-09: 20 XP');
        mocks.logs.taskXpLog['2026-08-09'] = 45; render(mobile); expect(detail()).toBe('2026-08-09: 45 XP');
        press('前の日'); expect(detail()).toBe('2026-08-08: 0 XP'); press('次の日'); expect(detail()).toBe('2026-08-09: 45 XP');
        press('今日'); expect(detail()).toBe('2026-08-10: 30 XP');
    });
    it('日付更新で未選択の今日が追従し、選択した過去日は保持する', () => {
        render(mobile); mocks.today = '2026-08-11'; render(mobile); expect(detail()).toBe('2026-08-11: 0 XP');
        press('前の日'); mocks.today = '2026-08-12'; render(mobile); expect(detail()).toBe('2026-08-10: 30 XP');
    });
    it('ログ消去時に旧値を表示せず、統計閲覧はデータを書き換えない', () => {
        const before = JSON.stringify(mocks.logs); render(mobile); press('前の日'); habits(); press('今日');
        expect(JSON.stringify(mocks.logs)).toBe(before); mocks.logs = { taskXpLog: {}, habitLog: {} }; render(mobile);
        expect(detail()).toBe('2026-08-10: 0個達成');
    });
    it('全日付を選択でき、期間の先頭では前の日へ進まない', () => {
        render(mobile);
        if (mobile) { press('統計の日付を選択'); expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(host.querySelectorAll('[role="dialog"] button')).toHaveLength(120); press('2026-04-14を選択'); }
        else { const select = host.querySelector('select')!; expect(select.options).toHaveLength(119); act(() => { select.value = '2026-04-14'; select.dispatchEvent(new Event('change', { bubbles: true })); }); }
        expect(detail()).toBe('2026-04-14: 0 XP'); expect(button('前の日').disabled).toBe(true);
        if (mobile) expect(host.querySelector('[role="dialog"]')).toBeNull();
        mocks.today = '2026-08-11'; render(mobile); expect(detail()).toBe('2026-08-11: 0 XP');
    });
});
it('Nativeの一覧を閉じる/タブ離脱で選択せず戻り、操作領域は44pt以上', () => {
    render(true); press('統計の日付を選択'); press('日付選択を閉じる'); expect(detail()).toBe('2026-08-10: 30 XP');
    press('統計の日付を選択'); mocks.focused = false; render(true); expect(host.querySelector('[role="dialog"]')).toBeNull();
    const styles = mocks.styles.get('統計の日付を選択') as Record<string, unknown>; expect(styles.minHeight).toBe(44); expect(styles).not.toHaveProperty('height');
});
