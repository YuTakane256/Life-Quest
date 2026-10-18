import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BATTLE_CONFIG, createBattleEngineState, type BattleActors } from '@life-quest/core/battle';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';
import { useAutomaticBattle } from '../../apps/mobile/src/hooks/useAutomaticBattle';
import { useGameStore } from '../stores/useGameStore';

const native = vi.hoisted(() => ({
    focused: true, appState: 'active', listeners: new Set<(state: string) => void>(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => {
    const focused = native.focused;
    useEffect(() => focused ? callback() : undefined, [callback, focused]);
} }));
vi.mock('react-native', () => {
    return {
        AppState: { get currentState() { return native.appState; }, addEventListener: (_: string, listener: (state: string) => void) => {
            native.listeners.add(listener); return { remove: () => native.listeners.delete(listener) };
        } },
    };
});

let root: Root | null;
let host: HTMLDivElement;
const interval = BATTLE_CONFIG.TURN_INTERVAL_MS;
const actors: BattleActors = {
    player: { attack: 20, defense: 10, maxHp: 200 }, playerName: '勇者', playerLevel: 10,
    enemy: { stage: 1, name: '敵', attack: 20, defense: 5, maxHp: 500, xpReward: 5 },
};
function start(override: Partial<BattleActors> = {}, mode: 'cloud' | 'local' = 'cloud') {
    const snapshot = { ...actors, ...override };
    useMobileGameStore.setState({ activeBattle: { stage: 1, actors: snapshot, state: createBattleEngineState(snapshot),
        actions: [], battleAttemptId: mode === 'cloud' ? 'attempt' : null, rewardMode: mode } });
    return snapshot;
}
function Harness({ enabled = true }: { enabled?: boolean }) {
    const battle = useMobileGameStore((state) => state.activeBattle);
    useAutomaticBattle(battle, enabled);
    return null;
}
function render(enabled = true) {
    act(() => root!.render(<StrictMode><Harness enabled={enabled} /></StrictMode>));
}
async function advance(ms: number = interval) { await act(async () => vi.advanceTimersByTimeAsync(ms)); }
function appState(state: string) {
    act(() => { native.appState = state; for (const listener of native.listeners) listener(state); });
}
const battle = () => useMobileGameStore.getState().activeBattle!;

beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a');
    vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    native.focused = true; native.appState = 'active'; native.listeners.clear(); vi.clearAllMocks();
    setGameRewardAuthorityState('anonymous');
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, activeBattle: null,
        lastLevelUp: null, battleProgress: { battleUnlocked: true, currentStage: 1, maxClearedStage: 0 } });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null; host.remove(); resetAuthLifecycleHooks(); localStorage.clear();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('Mobileの自動通常攻撃とWebの操作パリティ', () => {
    it('StrictModeでもWebと同じ1000msごとに1行動だけ進む', async () => {
        start(); render(); expect(native.listeners.size).toBe(1);
        await advance(interval - 1); expect(battle().actions).toHaveLength(0);
        await advance(1); expect(battle().actions).toEqual([{ type: 'attack' }]);
        await advance(interval * 2); expect(battle().actions).toHaveLength(3);
        expect(battle().state.logs).toHaveLength(6);
    });
    it('スキルを使って再描画しても通常攻撃の時計をリセットせず、Webと同じ状態になる', async () => {
        const snapshot = start(); render();
        useGameStore.setState((state) => ({ battle: { ...state.battle, status: 'idle', battleUnlocked: true, maxClearedStage: 0 } }));
        useGameStore.getState().startCloudBattle(1, 'web-attempt', { ...snapshot.player, level: snapshot.playerLevel, name: snapshot.playerName },
            { ...snapshot.enemy, hp: snapshot.enemy.maxHp });
        await advance(interval - 100);
        act(() => { useMobileGameStore.getState().performBattleAction({ type: 'skill', skillId: 'guard_stance' }); });
        useGameStore.getState().activateBattleSkill('guard_stance');
        expect(battle().actions).toHaveLength(1); expect(battle().state.guardTurnsRemaining).toBe(1);
        expect(battle().state.skillCooldowns.guard_stance).toBe(3);
        await advance(100); useGameStore.getState().processBattleTurn();
        const web = useGameStore.getState().battle;
        expect(battle().state).toMatchObject({ playerHp: web.playerHp, enemyHp: web.enemy!.hp, logs: web.logs,
            skillCooldowns: web.skillCooldowns, guardTurnsRemaining: web.guardTurnsRemaining, outcome: 'ongoing' });
        expect(battle().actions).toEqual(web.actions);
    });
    it('タブ移動中は止まり、戻った時点から再開し、経過分をまとめて攻撃しない', async () => {
        start(); render(); await advance(500);
        native.focused = false; render(); await advance(5000); expect(battle().actions).toHaveLength(0);
        native.focused = true; render(); await advance(999); expect(battle().actions).toHaveLength(0);
        await advance(1); expect(battle().actions).toHaveLength(1);
    });
    it.each(['background', 'inactive'])('%sでは進行を止め、foregroundで新しい間隔から再開する', async (state) => {
        start(); render(); await advance(400); appState(state); await advance(5000);
        expect(battle().actions).toHaveLength(0); appState('active'); await advance(999);
        expect(battle().actions).toHaveLength(0); await advance(1); expect(battle().actions).toHaveLength(1);
    });
    it('開始時にbackgroundならactive通知まで進めない', async () => {
        native.appState = 'background'; start(); render(); await advance(5000); expect(battle().actions).toHaveLength(0);
        appState('active'); await advance(); expect(battle().actions).toHaveLength(1);
    });
    it('アプリ状態が不明ならactive通知を待つ', async () => {
        native.appState = ''; start(); render(); await advance(5000); expect(battle().actions).toHaveLength(0);
        appState('active'); await advance(); expect(battle().actions).toHaveLength(1);
    });
    it('復帰前にキューへ入った古いtickは、新しい周期を進めたり停止したりしない', async () => {
        const timer = vi.spyOn(globalThis, 'setInterval'); start(); render();
        const oldCallback = timer.mock.calls.at(-1)![0] as () => void;
        appState('background'); appState('active'); act(() => oldCallback());
        expect(battle().actions).toHaveLength(0);
        await advance(); expect(battle().actions).toHaveLength(1);
    });
    it('重複したactive通知では時計をリセットしない', async () => {
        start(); render(); await advance(900); appState('active');
        await advance(100); expect(battle().actions).toHaveLength(1);
    });
    it('勝利後は止まり、ローカルXPを一度だけ付与する', async () => {
        start({ enemy: { ...actors.enemy, maxHp: 1 } }, 'local'); render(); await advance(5000);
        expect(battle().state.outcome).toBe('victory'); expect(battle().actions).toHaveLength(1);
        expect(useMobileGameStore.getState().character.totalXp).toBe(5);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('敗北後は止まり、XPを与えずリトライを表示する', async () => {
        start({ player: { ...actors.player, maxHp: 1 } }, 'local'); render(); await advance(5000);
        expect(battle().state.outcome).toBe('defeat'); expect(battle().actions).toHaveLength(1);
        expect(useMobileGameStore.getState().character.totalXp).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('クラウド戦闘では行動列を記録するだけで、勝利XPは決着適用まで与えない', async () => {
        start({ enemy: { ...actors.enemy, maxHp: 1 } }); render(); await advance(5000);
        expect(battle().state.outcome).toBe('victory'); expect(battle().actions).toEqual([{ type: 'attack' }]);
        expect(useMobileGameStore.getState().character.totalXp).toBe(0);
    });
    it('開始処理中/無効時は進行しない', async () => {
        start(); render(false); await advance(5000); expect(battle().actions).toHaveLength(0);
        render(); await advance(); expect(battle().actions).toHaveLength(1);
    });
    it('hydrate待ちはストア側でも防ぎ、戦闘がなければタイマーを作らない', async () => {
        render(); expect(vi.getTimerCount()).toBe(0);
        act(() => { start(); useMobileGameStore.setState({ hasHydrated: false }); });
        await advance(5000); expect(battle().actions).toHaveLength(0);
    });
    it('別戦闘へ置換されたら古いcallbackは新しい戦闘を進めない', () => {
        const timer = vi.spyOn(globalThis, 'setInterval'); start(); render();
        const oldCallback = timer.mock.calls.at(-1)![0] as () => void;
        act(() => { start(); oldCallback(); }); expect(battle().actions).toHaveLength(0);
    });
    it('同じactorsを使った別attemptでも古いcallbackは動かない', () => {
        const timer = vi.spyOn(globalThis, 'setInterval'); start(); render();
        const oldCallback = timer.mock.calls.at(-1)![0] as () => void;
        act(() => { useMobileGameStore.setState({ activeBattle: { ...battle(), battleAttemptId: 'new-attempt' } }); oldCallback(); });
        expect(battle().actions).toHaveLength(0);
    });
    it.each(['switch', 'logout-login'])('%sでは古いcallback/foreground通知から進行しない', async (transition) => {
        const timer = vi.spyOn(globalThis, 'setInterval'); start(); render();
        const oldCallback = timer.mock.calls.at(-1)![0] as () => void;
        await act(async () => { if (transition === 'logout-login') { await notifyLogout(); await notifyLogin('a'); } else await notifyLogin('b'); });
        appState('background'); appState('active'); act(() => oldCallback()); await advance(5000);
        expect(battle().actions).toHaveLength(0);
    });
    it('同じユーザー通知では時計を止めない', async () => {
        start(); render(); await act(async () => notifyLogin('a')); await advance(); expect(battle().actions).toHaveLength(1);
    });
    it('アンマウントでタイマー/購読を解除し、取得済みcallbackも無効にする', async () => {
        const timer = vi.spyOn(globalThis, 'setInterval'); start(); render();
        const oldCallback = timer.mock.calls.at(-1)![0] as () => void;
        act(() => { root!.unmount(); root = null; });
        expect(native.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
        act(() => oldCallback()); await advance(5000); expect(battle().actions).toHaveLength(0);
    });
});
