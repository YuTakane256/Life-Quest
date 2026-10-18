import { act, createElement, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBattleEngineState, type BattleActors } from '@life-quest/core/battle';
import type { ActiveMobileBattle } from '../stores/useMobileGameStore';
import { BattleOverview } from './BattleOverview';

vi.mock('react-native', async () => {
    const { createElement } = await import('react');
    type Props = { children?: ReactNode; accessibilityLabel?: string; disabled?: boolean;
        onPress?: () => void; ref?: React.Ref<HTMLDivElement> };
    const box = ({ children, accessibilityLabel, ref }: Props) => createElement('div', { 'aria-label': accessibilityLabel, ref }, children);
    return { View: box, ScrollView: box, Text: ({ children }: Props) => createElement('span', {}, children), Image: () => null,
        Pressable: ({ children, accessibilityLabel, disabled, onPress }: Props) => createElement('button', {
            'aria-label': accessibilityLabel, disabled, onClick: onPress,
        }, children), StyleSheet: { create: <T>(value: T) => value } };
});
vi.mock('lucide-react-native', () => ({ ChevronRight: () => null, RotateCcw: () => null, Skull: () => null, Trophy: () => null }));
vi.mock('../theme/usePalette', async () => {
    const { getMobileThemePalette } = await import('../theme/colors');
    return { usePalette: () => ({ palette: getMobileThemePalette('dark') }) };
});
let root: Root;
let host: HTMLDivElement;
const actors: BattleActors = { player: { attack: 20, defense: 10, maxHp: 100 }, playerLevel: 5, playerName: '勇者',
    enemy: { stage: 1, name: '敵', maxHp: 100, attack: 10, defense: 5, xpReward: 5 } };
let battle: ActiveMobileBattle;
const action = vi.fn(); const map = vi.fn(); const start = vi.fn(); const resend = vi.fn();
function render(busy = false, resolveState: 'idle' | 'error' = 'idle') {
    act(() => root.render(createElement(StrictMode, {}, createElement(BattleOverview, {
        battle, avatar: 'female', busy, resolveState, granted: null,
        onAction: action, onMap: map, onStart: start, onRetryResolve: resend,
    }))));
}
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    battle = { stage: 1, actors, state: createBattleEngineState(actors), actions: [], battleAttemptId: null, rewardMode: 'local' };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('Mobile戦闘中の操作をWebに揃える', () => {
    it('手動攻撃/途中終了はなく、解放済みスキルを選べる', () => {
        render(); expect(button('通常攻撃')).toBeNull(); expect(button('戦闘を閉じる')).toBeNull();
        act(() => button('強撃')!.click()); expect(action).toHaveBeenCalledWith({ type: 'skill', skillId: 'power_strike' });
        act(() => button('応急手当')!.click()); expect(action).toHaveBeenCalledWith({ type: 'skill', skillId: 'first_aid' });
        act(() => button('防御態勢')!.click()); expect(action).toHaveBeenCalledWith({ type: 'skill', skillId: 'guard_stance' });
    });
    it('クールダウン/開始中はスキルを実行しない', () => {
        battle.state.skillCooldowns.power_strike = 2; render();
        expect(button('強撃 クールダウン2')?.disabled).toBe(true);
        act(() => button('強撃 クールダウン2')!.click()); expect(action).not.toHaveBeenCalled();
        render(true); expect(button('防御態勢')?.disabled).toBe(true);
    });
    it('レベルに応じて解放されるスキルだけ表示する', () => {
        battle.actors = { ...actors, playerLevel: 1 }; render();
        expect(button('強撃')).not.toBeNull(); expect(button('応急手当')).toBeNull(); expect(button('防御態勢')).toBeNull();
    });
    it.each(['victory', 'defeat'] as const)('%sではスキルを消し、結果後の移動を維持する', (outcome) => {
        battle.state.outcome = outcome; render(); expect(button('強撃')).toBeNull();
        act(() => button(outcome === 'victory' ? '次へ' : 'リトライ')!.click());
        expect(start).toHaveBeenCalledWith(outcome === 'victory' ? 2 : 1);
        act(() => button('マップへ')!.click()); expect(map).toHaveBeenCalledTimes(1);
    });
    it('未同期の勝利では次戦/マップを止め、同じ結果の再送を維持する', () => {
        battle.state.outcome = 'victory'; battle.rewardMode = 'cloud'; battle.battleAttemptId = 'attempt'; render(false, 'error');
        expect(button('次へ')?.disabled).toBe(true); expect(button('マップへ')?.disabled).toBe(true);
        act(() => button('バトル結果の同期を再送する')!.click()); expect(resend).toHaveBeenCalledTimes(1);
    });
});
