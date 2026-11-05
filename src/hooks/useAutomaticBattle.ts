import { useEffect } from 'react';
import { BATTLE_CONFIG } from '@life-quest/core/battle';
import { captureAuthSessionGuard, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';
import { useGameStore } from '../stores/useGameStore';
import type { BattleState } from '../types';

/** Run normal attacks only for this visible map's current battle and auth scope. */
export function useAutomaticBattle(battle: BattleState) {
    const snapshot = battle.playerSnapshot;
    const stage = battle.currentStage;
    const attemptId = battle.battleAttemptId;
    const mode = battle.rewardMode;
    const status = battle.status;
    useEffect(() => {
        if (status !== 'fighting' || !snapshot) return;
        const isCurrentSession = captureAuthSessionGuard();
        let active = true;
        let visible = document.visibilityState === 'visible';
        let timer: number | null = null;
        let generation = 0;
        const stop = () => {
            generation += 1;
            if (timer !== null) window.clearInterval(timer);
            timer = null;
        };
        const isCurrentBattle = () => {
            const current = useGameStore.getState().battle;
            // Each start has an immutable player snapshot; turns/skills replace state/actions only.
            return current.status === 'fighting' && current.playerSnapshot === snapshot
                && current.currentStage === stage && current.battleAttemptId === attemptId && current.rewardMode === mode;
        };
        const start = () => {
            stop();
            if (!active || !visible || !isCurrentSession() || !isCurrentBattle()) return;
            const clock = generation;
            timer = window.setInterval(() => {
                if (clock !== generation) return;
                // Visibility can change before its event is delivered.
                if (document.visibilityState !== 'visible') { visible = false; stop(); return; }
                if (!active || !visible || !isCurrentSession() || !isCurrentBattle()) { stop(); return; }
                useGameStore.getState().processBattleTurn();
                if (!isCurrentBattle()) stop();
            }, BATTLE_CONFIG.TURN_INTERVAL_MS);
        };
        const onVisibilityChange = () => {
            const next = document.visibilityState === 'visible';
            if (visible === next) return;
            visible = next;
            if (visible) start(); else stop();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        const unsubscribe = subscribeAuthSessionScope(stop);
        start();
        return () => { active = false; stop(); document.removeEventListener('visibilitychange', onVisibilityChange); unsubscribe(); };
    }, [snapshot, stage, attemptId, mode, status]);
}
