/**
 * バトル開始をクラウド権威で行う（可能な場合）。
 *
 * 認証済みならクラウド開始だけを許可する。認証の確認不能・クラウド開始失敗時は
 * ローカル報酬へフォールバックせず、UIへ再試行可能な失敗結果を返す。
 *
 * `isStarting`中の呼び出しは二重開始防止のため無視する。
 */
import { useRef, useState } from 'react';
import {
    getBattleStartMessage,
    requestBattleStart,
    type BattleAuthState,
    type BattleStartResult,
} from '@life-quest/core/battleStartPolicy';
import { useGameStore } from '../stores/useGameStore';
import { startCloudBattleAttempt, type CloudBattleAttempt } from '../platform/gameCloud';
import { getBattleAuthState } from '../platform/auth';
import type { BattlePlayerSnapshot, Enemy } from '../types';
import { captureAuthSessionGuard } from '@life-quest/core/authLifecycle';
import { useGameOperationScope } from './useGameOperationScope';

export interface UseCloudBattleStartResult {
    isStarting: boolean;
    startError: string | null;
    startStage: (stage: number, beforeStart?: () => void) => Promise<BattleStartResult<CloudBattleAttempt>>;
    retry: () => Promise<BattleStartResult<CloudBattleAttempt> | null>;
}

export interface CloudBattleStartDeps {
    isActive?: () => boolean;
    canApply?: () => boolean;
    sessionUserId?: string | null;
    getBattleAuthState: () => Promise<BattleAuthState>;
    startCloudBattleAttempt: (stage: number, idempotencyKey: string, expectedUserId: string) => Promise<CloudBattleAttempt | null>;
    startBattle: (stage: number) => void;
    startCloudBattle: (
        stage: number,
        battleAttemptId: string,
        playerSnapshot: BattlePlayerSnapshot,
        enemy: Enemy,
    ) => void;
}

/**
 * `startStage`の判断ロジック本体。Reactの状態管理から切り離し、共有ポリシー
 * の結果を直接テストできるようにする。
 */
export async function runCloudBattleStart(
    stage: number,
    idempotencyKey: string,
    deps: CloudBattleStartDeps,
    beforeStart?: () => void,
): Promise<BattleStartResult<CloudBattleAttempt>> {
    const scopeIsCurrent = captureAuthSessionGuard();
    const isActive = () => scopeIsCurrent() && (deps.isActive?.() ?? true);
    if (!isActive() || deps.canApply?.() === false) return { kind: 'auth-changed' };
    let auth: BattleAuthState;
    try { auth = await deps.getBattleAuthState(); } catch { return { kind: 'unavailable' }; }
    if (!isActive() || deps.canApply?.() === false) return { kind: 'auth-changed' };
    const result = await requestBattleStart(
        auth,
        deps.getBattleAuthState,
        (expectedUserId) => deps.startCloudBattleAttempt(stage, idempotencyKey, expectedUserId),
        { isActive, expectedUserId: deps.sessionUserId },
    );
    if (!isActive() || deps.canApply?.() === false) return { kind: 'auth-changed' };
    if (result.kind === 'cloud-started') {
        beforeStart?.();
        if (!isActive()) return { kind: 'auth-changed' };
        const attempt = result.attempt;
        const playerSnapshot: BattlePlayerSnapshot = {
            attack: attempt.actors.player.attack,
            defense: attempt.actors.player.defense,
            maxHp: attempt.actors.player.maxHp,
            level: attempt.actors.playerLevel,
            name: attempt.actors.playerName,
        };
        const enemy: Enemy = { ...attempt.actors.enemy, hp: attempt.actors.enemy.maxHp };
        deps.startCloudBattle(stage, attempt.battleAttemptId, playerSnapshot, enemy);
    } else if (result.kind === 'local-started') {
        beforeStart?.();
        if (!isActive()) return { kind: 'auth-changed' };
        deps.startBattle(stage);
    }
    return result;
}

export function useCloudBattleStart(): UseCloudBattleStartResult {
    const startBattle = useGameStore((state) => state.startBattle);
    const startCloudBattle = useGameStore((state) => state.startCloudBattle);
    const [isStarting, setIsStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);
    const retryRef = useRef<{ stage: number; idempotencyKey: string; beforeStart?: () => void; isCurrent: () => boolean } | null>(null);
    const operationScope = useGameOperationScope(() => {
        retryRef.current = null; setIsStarting(false); setStartError(null);
    });

    const startStage = async (
        stage: number,
        beforeStart?: () => void,
        idempotencyKey: string = crypto.randomUUID(),
    ): Promise<BattleStartResult<CloudBattleAttempt>> => {
        const operation = operationScope.begin();
        if (!operation) return { kind: 'retryable-error' };
        const sourceBattle = useGameStore.getState().battle;
        const sourceIsCurrent = () => {
            const current = useGameStore.getState().battle;
            // 同じ進行の定期pullによるオブジェクト再生成は別戦闘とみなさない。
            return current.battleAttemptId === sourceBattle.battleAttemptId && current.status === sourceBattle.status
                && current.currentStage === sourceBattle.currentStage && current.actions === sourceBattle.actions;
        };
        retryRef.current = null;
        setIsStarting(true);
        setStartError(null);
        try {
            const result = await runCloudBattleStart(
                stage,
                idempotencyKey,
                { getBattleAuthState, startCloudBattleAttempt: (target, key, owner) =>
                    startCloudBattleAttempt(target, key, owner, { isActive: () => operation.isActive() && sourceIsCurrent(), expectedUserId: owner }),
                startBattle, startCloudBattle, isActive: operation.isActive, canApply: sourceIsCurrent, sessionUserId: operation.userId },
                beforeStart,
            );
            if (!operation.isActive()) return { kind: 'auth-changed' };
            if (result.kind === 'cloud-started' || result.kind === 'local-started') {
                retryRef.current = null;
            } else {
                if (!sourceIsCurrent()) return { kind: 'auth-changed' };
                retryRef.current = { stage, idempotencyKey, beforeStart, isCurrent: sourceIsCurrent };
                setStartError(getBattleStartMessage(result));
            }
            return result;
        } catch {
            if (!operation.isActive() || !sourceIsCurrent()) return { kind: 'auth-changed' };
            retryRef.current = { stage, idempotencyKey, beforeStart, isCurrent: sourceIsCurrent };
            setStartError(getBattleStartMessage({ kind: 'retryable-error' }));
            return { kind: 'retryable-error' };
        } finally {
            if (operation.isActive()) setIsStarting(false);
            operation.finish();
        }
    };

    const retry = async (): Promise<BattleStartResult<CloudBattleAttempt> | null> => {
        const pending = retryRef.current;
        if (pending && !pending.isCurrent()) { retryRef.current = null; setStartError(null); return null; }
        return pending ? startStage(pending.stage, pending.beforeStart, pending.idempotencyKey) : null;
    };

    return { isStarting, startError, startStage, retry };
}
