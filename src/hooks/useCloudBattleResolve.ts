/**
 * クラウド権威バトルの決着（victory/defeat）をサーバーへ同期する。
 *
 * `battle.status`が`victory`/`defeat`へ遷移し、かつ`rewardMode === 'cloud'`
 * のときだけ`resolveCloudBattleAttempt`を呼ぶ。二重発火防止は二段構え:
 * (a) このフックが処理済みattemptIdをrefで記録する（React StrictModeの
 *     effect二重実行対策。refへの書き込みはawaitの前、同期的に行う）
 * (b) store側の`applyResolvedCloudBattle`が適用後にbattleAttemptIdを
 *     クリアするため（#575）、成功後は依存配列の変化でこのeffectが
 *     再評価されてもガードで弾かれる
 *
 * 失敗時は`resolveState`が`'error'`になり、`retry()`で同一attemptId・
 * 同一actionsで再送できる（サーバーのidempotency_keysが安全に処理する）。
 */
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { resolveCloudBattleAttempt, type ResolveBattleAttemptResponse } from '../platform/gameCloud';
import type { BattleAction } from '@life-quest/core/battle';
import { captureAuthSessionGuard, captureAuthSessionScope, type AuthSessionScope } from '@life-quest/core/authLifecycle';
import { getGameAuthState } from '../platform/auth';
import { useGameOperationScope } from './useGameOperationScope';

export type CloudBattleResolveState = 'idle' | 'syncing' | 'done' | 'error';

export interface UseCloudBattleResolveResult {
    resolveState: CloudBattleResolveState;
    /** resolve成功時のgranted結果。未同期・失敗時はnull */
    granted: boolean | null;
    /** エラー時、同一attemptId・actionsで再送する */
    retry: () => void;
}

export interface CloudBattleResolveDeps {
    isActive?: () => boolean;
    resolveCloudBattleAttempt: (
        battleAttemptId: string,
        actions: readonly BattleAction[],
    ) => Promise<ResolveBattleAttemptResponse>;
    applyResolvedCloudBattle: (battleAttemptId: string, outcome: 'victory' | 'defeat', granted: boolean) => void;
}

export type CloudBattleResolveOutcome =
    | { status: 'done'; granted: boolean }
    | { status: 'error' };

/**
 * resolve送信の判断ロジック本体。成功時は`applyResolvedCloudBattle`まで
 * 適用してから結果を返す（呼び出し元は返り値でstate更新するだけでよい）。
 * Reactの状態管理から切り離した純粋な非同期関数として抽出し、
 * `useCloudBattleResolve.test.ts`から直接テストできるようにする。
 */
export async function runCloudBattleResolve(
    attemptId: string,
    actions: readonly BattleAction[],
    deps: CloudBattleResolveDeps,
): Promise<CloudBattleResolveOutcome> {
    const isActive = deps.isActive ?? captureAuthSessionGuard();
    if (!isActive()) return { status: 'error' };
    try {
        const response = await deps.resolveCloudBattleAttempt(attemptId, actions.map((action) => ({ ...action })));
        if (!isActive()) return { status: 'error' };
        deps.applyResolvedCloudBattle(attemptId, response.outcome, response.granted);
        return { status: 'done', granted: response.granted };
    } catch {
        return { status: 'error' };
    }
}

export function useCloudBattleResolve(): UseCloudBattleResolveResult {
    const battle = useGameStore((state) => state.battle);
    const applyResolvedCloudBattle = useGameStore((state) => state.applyResolvedCloudBattle);
    const [resolveState, setResolveState] = useState<CloudBattleResolveState>('idle');
    const [granted, setGranted] = useState<boolean | null>(null);
    const resolvedAttemptIdRef = useRef<string | null>(null);
    const appliedAttemptRef = useRef<string | null>(null);
    const pendingRef = useRef<{ attemptId: string; actions: BattleAction[]; key: string } | null>(null);
    const bindingRef = useRef<{ attemptId: string; scope: AuthSessionScope } | null>(null);
    const operationScope = useGameOperationScope(() => {
        resolvedAttemptIdRef.current = null; appliedAttemptRef.current = null; pendingRef.current = null;
        setResolveState('idle'); setGranted(null);
    });

    const isTarget = (attemptId: string): boolean => {
        const current = useGameStore.getState().battle;
        return current.battleAttemptId === attemptId && current.rewardMode === 'cloud'
            && (current.status === 'victory' || current.status === 'defeat');
    };
    const runResolve = async (attemptId: string, actions: readonly BattleAction[]): Promise<void> => {
        if (!isTarget(attemptId)) return;
        const binding = bindingRef.current;
        // 起動時の未確定スコープは最初の認証復元で結び直す。既知の旧セッションは復活させない。
        if (binding?.attemptId === attemptId && binding.scope.userId !== null && !binding.scope.isCurrent()) return;
        if (!binding || binding.attemptId !== attemptId || binding.scope.userId === null) {
            bindingRef.current = { attemptId, scope: captureAuthSessionScope() };
        }
        const operation = operationScope.begin();
        if (!operation) return;
        const pending = pendingRef.current?.attemptId === attemptId ? pendingRef.current
            : { attemptId, actions: actions.map((action) => ({ ...action })), key: crypto.randomUUID() };
        pendingRef.current = pending;
        resolvedAttemptIdRef.current = attemptId;
        setResolveState('syncing');
        setGranted(null);
        try {
            const auth = await getGameAuthState();
            if (!operation.isActive() || !isTarget(attemptId)) return;
            if (auth.kind !== 'authenticated' || auth.userId !== operation.userId) { setResolveState('error'); return; }
            const outcome = await runCloudBattleResolve(attemptId, pending.actions, {
                resolveCloudBattleAttempt: (id, snapshot) => resolveCloudBattleAttempt(id, snapshot, {
                    isActive: () => operation.isActive() && isTarget(attemptId), expectedUserId: auth.userId, idempotencyKey: pending.key,
                }),
                applyResolvedCloudBattle: (id, result, granted) => {
                    appliedAttemptRef.current = id;
                    applyResolvedCloudBattle(id, result, granted);
                },
                isActive: () => operation.isActive() && isTarget(attemptId),
            });
            if (!operation.isActive()) return;
            if (outcome.status === 'done') {
                pendingRef.current = null; setGranted(outcome.granted); setResolveState('done');
            } else if (isTarget(attemptId)) setResolveState('error');
        } catch {
            if (operation.isActive() && isTarget(attemptId)) setResolveState('error');
        } finally { operation.finish(); }
    };

    // StrictModeのeffect再セットアップでは初回の無効化済み要求に代わり再開する。
    useEffect(() => () => { resolvedAttemptIdRef.current = null; }, []);
    useEffect(() => {
        const terminal = battle.status === 'victory' || battle.status === 'defeat';
        if (!terminal || battle.rewardMode !== 'cloud' || !battle.battleAttemptId) {
            if (terminal && battle.rewardMode === 'cloud' && appliedAttemptRef.current !== null
                && appliedAttemptRef.current === resolvedAttemptIdRef.current) return;
            operationScope.cancel(); resolvedAttemptIdRef.current = null; pendingRef.current = null; appliedAttemptRef.current = null; bindingRef.current = null;
            setResolveState('idle'); setGranted(null); return;
        }
        if (resolvedAttemptIdRef.current === battle.battleAttemptId) return;
        operationScope.cancel(); appliedAttemptRef.current = null;
        void runResolve(battle.battleAttemptId, battle.actions);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [battle.status, battle.rewardMode, battle.battleAttemptId, battle.currentStage, operationScope.revision]);

    const retry = (): void => {
        const pending = pendingRef.current;
        if (pending) void runResolve(pending.attemptId, pending.actions);
    };

    return { resolveState, granted, retry };
}
