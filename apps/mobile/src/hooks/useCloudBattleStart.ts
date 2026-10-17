import { useRef, useState } from 'react';
import { getBattleStartMessage, requestBattleStart, type BattleStartResult } from '@life-quest/core/battleStartPolicy';
import { hasPendingBattleResult } from '@life-quest/core/battle';
import { getBattleAuthState } from '../platform/auth';
import { startCloudBattleAttempt, type CloudBattleAttempt } from '../platform/battleCloud';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { createMobileId } from '../utils/createMobileId';
import { useGameOperationScope } from './useGameOperationScope';

/** MapScreenの開始・再試行を認証スコープと同期ゲートへ結び付ける。 */
export function useCloudBattleStart() {
    const [isStarting, setIsStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);
    const retryRef = useRef<{ stage: number; key: string; beforeStart?: () => void; isCurrent: () => boolean } | null>(null);
    const operationScope = useGameOperationScope(() => {
        retryRef.current = null; setIsStarting(false); setStartError(null);
    });
    async function startStage(stage: number, beforeStart?: () => void, key = createMobileId()): Promise<BattleStartResult<CloudBattleAttempt>> {
        const state = useMobileGameStore.getState();
        const battle = state.activeBattle;
        if (battle && hasPendingBattleResult(battle.state.outcome, battle.rewardMode, battle.battleAttemptId)) return { kind: 'rejected' };
        const operation = operationScope.begin();
        if (!operation) return { kind: 'retryable-error' };
        const sourceIsCurrent = () => {
            const current = useMobileGameStore.getState();
            return current.activeBattle === state.activeBattle
                && current.battleProgress?.battleUnlocked === state.battleProgress?.battleUnlocked
                && current.battleProgress?.currentStage === state.battleProgress?.currentStage
                && current.battleProgress?.maxClearedStage === state.battleProgress?.maxClearedStage;
        };
        retryRef.current = null;
        setIsStarting(true); setStartError(null);
        try {
            const auth = await getBattleAuthState();
            if (!operation.isActive() || !sourceIsCurrent()) return { kind: 'auth-changed' };
            let result = await requestBattleStart(auth, getBattleAuthState,
                (owner) => startCloudBattleAttempt(stage, key, owner, { isActive: () => operation.isActive() && sourceIsCurrent(), expectedUserId: owner }),
                { isActive: operation.isActive, expectedUserId: operation.userId });
            if (!operation.isActive() || !sourceIsCurrent()) return { kind: 'auth-changed' };
            if (result.kind === 'cloud-started') {
                useMobileGameStore.getState().startCloudBattle(stage, result.attempt.battleAttemptId, result.attempt.actors);
                beforeStart?.();
            } else if (result.kind === 'local-started') {
                if (!useMobileGameStore.getState().startBattle(stage)) result = { kind: 'rejected' };
                else beforeStart?.();
            }
            if (!operation.isActive()) return { kind: 'auth-changed' };
            if (result.kind === 'cloud-started' || result.kind === 'local-started') retryRef.current = null;
            else {
                retryRef.current = { stage, key, beforeStart, isCurrent: sourceIsCurrent };
                setStartError(getBattleStartMessage(result));
            }
            return result;
        } catch {
            if (!operation.isActive() || !sourceIsCurrent()) return { kind: 'auth-changed' };
            retryRef.current = { stage, key, beforeStart, isCurrent: sourceIsCurrent };
            setStartError(getBattleStartMessage({ kind: 'retryable-error' }));
            return { kind: 'retryable-error' };
        } finally {
            if (operation.isActive()) setIsStarting(false);
            operation.finish();
        }
    }
    return {
        isStarting, startError, startStage,
        retry: () => {
            const pending = retryRef.current;
            if (pending && !pending.isCurrent()) { retryRef.current = null; setStartError(null); return Promise.resolve(null); }
            return pending ? startStage(pending.stage, pending.beforeStart, pending.key) : Promise.resolve(null);
        },
        clearError: () => { retryRef.current = null; setStartError(null); },
    };
}
