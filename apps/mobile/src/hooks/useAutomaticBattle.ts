import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BATTLE_CONFIG } from '@life-quest/core/battle';
import { captureAuthSessionGuard, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';
import { useMobileGameStore, type ActiveMobileBattle } from '../stores/useMobileGameStore';

/** Match Web's timed normal attacks; skills remain explicit actions in the same engine. */
export function useAutomaticBattle(battle: ActiveMobileBattle | null, enabled: boolean) {
    const actors = battle?.actors;
    const stage = battle?.stage;
    const outcome = battle?.state.outcome;
    const attemptId = battle?.battleAttemptId;
    useFocusEffect(useCallback(() => {
        if (!enabled || !actors || outcome !== 'ongoing') return;
        const isCurrentSession = captureAuthSessionGuard();
        let focused = true;
        let foreground = AppState.currentState === 'active';
        let timer: ReturnType<typeof setInterval> | null = null;
        let clockGeneration = 0;
        const stop = () => {
            clockGeneration += 1;
            if (timer !== null) clearInterval(timer);
            timer = null;
        };
        const isCurrentBattle = () => {
            const store = useMobileGameStore.getState();
            const current = store.activeBattle;
            // actors is the immutable per-attempt snapshot; each turn replaces only state/actions.
            return store.hasHydrated && current?.actors === actors && current.stage === stage
                && current.battleAttemptId === attemptId && current.state.outcome === 'ongoing';
        };
        const start = () => {
            stop();
            if (!focused || !foreground || !isCurrentSession() || !isCurrentBattle()) return;
            const generation = clockGeneration;
            timer = setInterval(() => {
                if (generation !== clockGeneration) return;
                if (!focused || !foreground || !isCurrentSession() || !isCurrentBattle()) { stop(); return; }
                useMobileGameStore.getState().performBattleAction({ type: 'attack' });
                if (!isCurrentBattle()) stop();
            }, BATTLE_CONFIG.TURN_INTERVAL_MS);
        };
        const subscription = AppState.addEventListener('change', (state) => {
            const nextForeground = state === 'active';
            if (foreground === nextForeground) return;
            foreground = nextForeground;
            if (foreground) start(); else stop();
        });
        const unsubscribe = subscribeAuthSessionScope(stop);
        start();
        return () => { focused = false; stop(); subscription.remove(); unsubscribe(); };
    }, [actors, attemptId, enabled, outcome, stage]));
}
