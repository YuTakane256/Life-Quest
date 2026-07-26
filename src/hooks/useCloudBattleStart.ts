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
    createBattleStartGate,
    getBattleStartMessage,
    requestBattleStart,
    type BattleAuthState,
    type BattleStartResult,
} from '@life-quest/core/battleStartPolicy';
import { useGameStore } from '../stores/useGameStore';
import { startCloudBattleAttempt, type CloudBattleAttempt } from '../platform/gameCloud';
import { getBattleAuthState } from '../platform/auth';
import type { BattlePlayerSnapshot, Enemy } from '../types';

export interface UseCloudBattleStartResult {
    isStarting: boolean;
    startError: string | null;
    startStage: (stage: number, beforeStart?: () => void) => Promise<BattleStartResult<CloudBattleAttempt>>;
    retry: () => Promise<BattleStartResult<CloudBattleAttempt> | null>;
}

export interface CloudBattleStartDeps {
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
    const result = await requestBattleStart(
        await deps.getBattleAuthState(),
        deps.getBattleAuthState,
        (expectedUserId) => deps.startCloudBattleAttempt(stage, idempotencyKey, expectedUserId),
    );
    if (result.kind === 'cloud-started') {
        beforeStart?.();
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
        deps.startBattle(stage);
    }
    return result;
}

export function useCloudBattleStart(): UseCloudBattleStartResult {
    const startBattle = useGameStore((state) => state.startBattle);
    const startCloudBattle = useGameStore((state) => state.startCloudBattle);
    const [isStarting, setIsStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);
    const startGateRef = useRef(createBattleStartGate());
    const retryRef = useRef<{ stage: number; idempotencyKey: string; beforeStart?: () => void } | null>(null);

    const startStage = async (
        stage: number,
        beforeStart?: () => void,
        idempotencyKey: string = crypto.randomUUID(),
    ): Promise<BattleStartResult<CloudBattleAttempt>> => {
        if (!startGateRef.current.tryEnter()) return { kind: 'retryable-error' };
        setIsStarting(true);
        setStartError(null);
        try {
            const result = await runCloudBattleStart(
                stage,
                idempotencyKey,
                { getBattleAuthState, startCloudBattleAttempt, startBattle, startCloudBattle },
                beforeStart,
            );
            if (result.kind === 'cloud-started' || result.kind === 'local-started') {
                retryRef.current = null;
            } else {
                retryRef.current = { stage, idempotencyKey, beforeStart };
                setStartError(getBattleStartMessage(result));
            }
            return result;
        } finally {
            startGateRef.current.leave();
            setIsStarting(false);
        }
    };

    const retry = async (): Promise<BattleStartResult<CloudBattleAttempt> | null> => {
        const pending = retryRef.current;
        return pending ? startStage(pending.stage, pending.beforeStart, pending.idempotencyKey) : null;
    };

    return { isStarting, startError, startStage, retry };
}
