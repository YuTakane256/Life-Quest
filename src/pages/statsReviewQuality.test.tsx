import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HabitDayActivity } from '@life-quest/core/stats';
const mocks = vi.hoisted(() => ({
    today: '2026-08-10', logs: { taskXpLog: {} as Record<string, number>, habitLog: {} as Record<string, HabitDayActivity> },
    game: { character: { totalXp: 60 }, battle: { maxClearedStage: 0 }, battleProgress: { maxClearedStage: 0 }, equipment: [] },
    title: { activeTitle: null as string | null, setActiveTitle: vi.fn<(title: string | null) => void>() },
    press: new Map<string, () => void>(), styles: new Map<string, unknown>(), textProps: new Map<string, unknown>(), focused: true,
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
    type Props = { children?: ReactNode; testID?: string; accessibilityLabel?: string; accessibilityRole?: string; accessibilityValue?: { now: number; max: number; text: string }; accessibilityState?: { selected: boolean }; disabled?: boolean; onPress?: () => void; style?: unknown; visible?: boolean; numberOfLines?: number };
    const View = ({ children, testID, accessibilityRole, accessibilityLabel, accessibilityValue }: Props) => createElement('div', { 'data-testid': testID, role: accessibilityRole, 'aria-label': accessibilityLabel, 'aria-valuenow': accessibilityValue?.now, 'aria-valuemax': accessibilityValue?.max, 'aria-valuetext': accessibilityValue?.text }, children);
    return { View, ScrollView: View, StyleSheet: { create: <T,>(value: T) => value },
        Modal: ({ visible, children }: Props) => visible ? createElement('div', { role: 'dialog' }, children) : null,
        Text: (props: Props) => { if (typeof props.children === 'string') mocks.textProps.set(props.children, props); return createElement('span', { 'data-testid': props.testID }, props.children); },
        Pressable: ({ children, accessibilityLabel, onPress, disabled, style, accessibilityState }: Props) => {
            if (accessibilityLabel) { mocks.press.set(accessibilityLabel, onPress!); mocks.styles.set(accessibilityLabel, style); }
            return createElement('button', { 'aria-label': accessibilityLabel, 'aria-pressed': accessibilityState?.selected, disabled, onClick: onPress }, children);
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
const weekly = () => host.querySelector('[aria-label="直近7日間のXP"], [data-testid="stats-weekly-card"]')!;
const best = () => host.querySelector('[aria-label="自己ベスト記録"], [data-testid="stats-best-card"]')!;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.today = '2026-08-10'; mocks.focused = true; mocks.press.clear(); mocks.styles.clear();
    mocks.logs = { taskXpLog: { '2026-08-09': 20, '2026-08-10': 30, '2026-01-01': 999 }, habitLog: { '2026-08-10': { count: 2, allComplete: true } } };
    mocks.game = { character: { totalXp: 60 }, battle: { maxClearedStage: 0 }, battleProgress: { maxClearedStage: 0 }, equipment: [] };
    mocks.title.activeTitle = null; mocks.title.setActiveTitle.mockReset(); mocks.title.setActiveTitle.mockImplementation((title) => { mocks.title.activeTitle = title; }); mocks.textProps.clear();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
describe.each([false, true])('実績と称号 mobile=%s', (mobile) => {
    const card = () => host.querySelector('[aria-label="実績と称号"], [data-testid="stats-achievements-card"]')!;
    const row = (id: string) => card().querySelector(`[data-testid="achievement-${id}"]`)!;
    it('全6実績の条件・進捗・報酬を省略せず表示し、未達成と達成を区別する', () => {
        render(mobile);
        expect(card().querySelectorAll('[data-testid^="achievement-"]')).toHaveLength(6);
        expect(card().textContent).toContain('1/6 達成');
        expect(row('first_level_up').textContent).toContain('達成 · 60/30');
        expect(row('steady_worker').textContent).toContain('XPを獲得した日を7日作る');
        expect(row('steady_worker').textContent).toContain('未達成 · 3/7');
        expect(row('steady_worker').textContent).toContain('獲得称号: 習慣の芽');
        const bar = row('first_level_up').querySelector('[role="progressbar"]')!;
        expect(bar.getAttribute('aria-valuenow')).toBe('30'); expect(bar.getAttribute('aria-valuemax')).toBe('30');
        expect(bar.getAttribute('aria-valuetext')).toBe('達成・60 / 30・獲得称号: 駆け出し冒険者');
        expect(card().querySelector('.truncate')).toBeNull();
        if (mobile) expect(mocks.textProps.get('XPを獲得した日を7日作る')).not.toHaveProperty('numberOfLines');
    });
    it('獲得済みの称号だけを選択でき、選択・解除を保存操作へ渡し表示も追従する', () => {
        render(mobile); expect(button('「駆け出し冒険者」を選択する')).toBeTruthy();
        expect(card().querySelector('[aria-label="「習慣の芽」を選択する"]')).toBeNull();
        const logs = JSON.stringify(mocks.logs); press('「駆け出し冒険者」を選択する'); render(mobile);
        expect(mocks.title.setActiveTitle).toHaveBeenLastCalledWith('駆け出し冒険者');
        expect(button('「駆け出し冒険者」を選択する').getAttribute('aria-pressed')).toBe('true');
        expect(card().textContent).toContain('表示中: 駆け出し冒険者');
        press('称号なしを選択する'); render(mobile); expect(mocks.title.setActiveTitle).toHaveBeenLastCalledWith(null);
        expect(button('称号なしを選択する').getAttribute('aria-pressed')).toBe('true');
        expect(card().textContent).toContain('表示中: 称号なし'); expect(JSON.stringify(mocks.logs)).toBe(logs);
        if (mobile) {
            const style = (mocks.styles.get('「駆け出し冒険者」を選択する') as unknown[])[0] as Record<string, unknown>;
            expect(style.minHeight).toBe(44); expect(style.minWidth).toBe(44); expect(style).not.toHaveProperty('height');
        }
    });
    it('全達成・ログ更新・空の状態を最新値へ戻し、閲覧だけで保存や称号解除を行わない', () => {
        mocks.game = { ...mocks.game, character: { totalXp: 1_000_000_000_000 }, battle: { maxClearedStage: 20 }, battleProgress: { maxClearedStage: 20 }, equipment: Array(10).fill(null) as never[] };
        mocks.logs = { taskXpLog: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`2026-08-0${i + 1}`, 10])), habitLog: Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`2026-08-0${i + 1}`, { count: 1, allComplete: true }])) };
        mocks.title.activeTitle = '古城の勝者'; render(mobile);
        expect(card().textContent).toContain('6/6 達成'); expect(card().textContent).toContain('1,000,000,000,000/30'); expect(card().textContent).toContain('表示中: 古城の勝者');
        mocks.logs = { taskXpLog: {}, habitLog: {} }; mocks.game = { ...mocks.game, character: { totalXp: 0 }, battle: { maxClearedStage: 0 }, battleProgress: { maxClearedStage: 0 }, equipment: [] }; render(mobile);
        expect(card().textContent).toContain('0/6 達成'); expect(card().textContent).toContain('実績を達成すると称号を選べます。');
        expect(card().textContent).toContain('表示中: 称号なし'); expect(card().querySelectorAll('button')).toHaveLength(0);
        expect(mocks.title.setActiveTitle).not.toHaveBeenCalled();
    });
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
    it('週間XP・全期間ベスト・実績の順で表示し、習慣モードでもタスクXPと明示する', () => {
        render(mobile); expect(weekly().textContent).toContain('⚡ 合計 50 XP'); expect(weekly().textContent).toContain('タスクXPのみ');
        expect(best().textContent).toContain('999 XP'); expect(best().textContent).toContain('2026-01-01');
        const text = host.textContent!; expect(text.indexOf('XP獲得ヒートマップ')).toBeLessThan(text.indexOf('直近7日間のXP'));
        expect(text.indexOf('直近7日間のXP')).toBeLessThan(text.indexOf('自己ベスト記録')); expect(text.indexOf('自己ベスト記録')).toBeLessThan(text.indexOf('🏅'));
        habits(); expect(weekly().textContent).toContain('⚡ 合計 50 XP');
    });
    it('7日の内訳を開閉でき、日付・ログ・消去後の最新値に更新する', () => {
        render(mobile); press('7日間の内訳');
        const contents = () => host.querySelector('#weekly-xp-details, [data-testid="weekly-xp-details"]')!;
        expect(contents().children).toHaveLength(7); expect(contents().textContent).toContain('2026-08-10（月）30 XP');
        mocks.logs = { ...mocks.logs, taskXpLog: { '2026-08-10': 80 } }; render(mobile);
        expect(weekly().textContent).toContain('⚡ 合計 80 XP'); expect(best().textContent).toContain('80 XP'); expect(best().textContent).not.toContain('999 XP');
        mocks.today = '2026-08-11'; render(mobile); expect(contents().textContent).toContain('2026-08-11（火）0 XP');
        mocks.logs = { taskXpLog: {}, habitLog: {} }; render(mobile);
        expect(weekly().textContent).toContain('⚡ 合計 0 XP'); expect(best().textContent).not.toContain('80 XP'); expect(best().textContent).toContain('—');
        press('7日間の内訳'); expect(contents()).toBeNull();
    });
});
it('Nativeの一覧を閉じる/タブ離脱で選択せず戻り、操作領域は44pt以上', () => {
    render(true); press('統計の日付を選択'); press('日付選択を閉じる'); expect(detail()).toBe('2026-08-10: 30 XP');
    press('統計の日付を選択'); mocks.focused = false; render(true); expect(host.querySelector('[role="dialog"]')).toBeNull();
    const styles = mocks.styles.get('統計の日付を選択') as Record<string, unknown>; expect(styles.minHeight).toBe(44); expect(styles).not.toHaveProperty('height');
});
