/**
 * クラウド権威バトルの決着（victory/defeat）をサーバーへ同期する。Web
 * `src/hooks/useCloudBattleResolve.ts`の移植（Webは`battle.status`を監視する
 * のに対し、Mobileストアは`activeBattle`（null許容）が`state.outcome`を
 * 保持するため、そちらを監視するように読み替えている）。
 *
 * `activeBattle.state.outcome`が`victory`/`defeat`へ遷移し、かつ
 * `rewardMode === 'cloud'`のときだけ`resolveCloudBattleAttempt`を呼ぶ。
 * 二重発火防止は二段構え:
 * (a) このフックが処理済みattemptIdをrefで記録する（awaitの前、同期的に
 *     行う）
 * (b) store側の`applyResolvedCloudBattle`が適用後にbattleAttemptIdを
 *     クリアするため、成功後は依存配列の変化でこのeffectが再評価されても
 *     ガードで弾かれる
 *
 * 失敗時は`resolveState`が`'error'`になり、`retry()`で同一attemptId・
 * 同一actionsで再送できる（サーバーのidempotency_keysが安全に処理する）。
 */
import { useEffect, useRef, useState } from 'react';
import { useMobileGameStore, type ActiveMobileBattle } from '../stores/useMobileGameStore';
import { resolveCloudBattleAttempt, type ResolveBattleAttemptResponse } from '../platform/battleCloud';
import type { BattleAction } from '@life-quest/core/battle';
import { captureAuthSessionGuard, captureAuthSessionScope, type AuthSessionScope } from '@life-quest/core/authLifecycle';
import { getGameAuthState } from '../platform/auth';
import { createMobileId } from '../utils/createMobileId';
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
 * 適用してから結果を返す。Reactの状態管理から切り離した純粋な非同期関数
 * として抽出し、`useCloudBattleResolve.test.ts`から直接テストできるようにする。
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

/**
 * effectの発火条件（決着がvictory/defeat、rewardModeがcloud、
 * battleAttemptIdが存在、まだこのattemptを処理していない）を切り出した
 * 純粋な述語。二重発火防止の同期的なref書き込み自体はeffect側に残す
 * （このガード自体はタイミングに影響しない）。
 */
export function shouldResolveBattle(
    activeBattle: ActiveMobileBattle | null,
    resolvedAttemptId: string | null,
): boolean {
    if (!activeBattle) return false;
    if (activeBattle.state.outcome !== 'victory' && activeBattle.state.outcome !== 'defeat') return false;
    if (activeBattle.rewardMode !== 'cloud' || !activeBattle.battleAttemptId) return false;
    if (resolvedAttemptId === activeBattle.battleAttemptId) return false;
    return true;
}

export function useCloudBattleResolve(): UseCloudBattleResolveResult {
    const activeBattle = useMobileGameStore((state) => state.activeBattle);
    const applyResolvedCloudBattle = useMobileGameStore((state) => state.applyResolvedCloudBattle);
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
        const current = useMobileGameStore.getState().activeBattle;
        return current?.battleAttemptId === attemptId && current.rewardMode === 'cloud'
            && (current.state.outcome === 'victory' || current.state.outcome === 'defeat');
    };
    const runResolve = async (attemptId: string, actions: readonly BattleAction[]): Promise<void> => {
        if (!isTarget(attemptId)) return;
        const binding = bindingRef.current;
        if (binding?.attemptId === attemptId && binding.scope.userId !== null && !binding.scope.isCurrent()) return;
        if (!binding || binding.attemptId !== attemptId || binding.scope.userId === null) {
            bindingRef.current = { attemptId, scope: captureAuthSessionScope() };
        }
        const operation = operationScope.begin();
        if (!operation) return;
        const pending = pendingRef.current?.attemptId === attemptId ? pendingRef.current
            : { attemptId, actions: actions.map((action) => ({ ...action })), key: createMobileId() };
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

    useEffect(() => () => { resolvedAttemptIdRef.current = null; }, []);
    useEffect(() => {
        const terminal = activeBattle?.state.outcome === 'victory' || activeBattle?.state.outcome === 'defeat';
        if (!terminal || activeBattle?.rewardMode !== 'cloud' || !activeBattle?.battleAttemptId) {
            if (terminal && activeBattle?.rewardMode === 'cloud' && appliedAttemptRef.current !== null
                && appliedAttemptRef.current === resolvedAttemptIdRef.current) return;
            operationScope.cancel(); resolvedAttemptIdRef.current = null; pendingRef.current = null; appliedAttemptRef.current = null; bindingRef.current = null;
            setResolveState('idle'); setGranted(null); return;
        }
        if (!shouldResolveBattle(activeBattle, resolvedAttemptIdRef.current)) return;
        const attemptId = activeBattle!.battleAttemptId!;
        operationScope.cancel(); appliedAttemptRef.current = null;
        void runResolve(attemptId, activeBattle!.actions);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeBattle?.state.outcome, activeBattle?.rewardMode, activeBattle?.battleAttemptId, activeBattle?.stage, operationScope.revision]);

    const retry = (): void => {
        const pending = pendingRef.current;
        if (pending) void runResolve(pending.attemptId, pending.actions);
    };

    return { resolveState, granted, retry };
}
