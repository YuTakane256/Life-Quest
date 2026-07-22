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

export type CloudBattleResolveState = 'idle' | 'syncing' | 'done' | 'error';

export interface UseCloudBattleResolveResult {
    resolveState: CloudBattleResolveState;
    /** resolve成功時のgranted結果。未同期・失敗時はnull */
    granted: boolean | null;
    /** エラー時、同一attemptId・actionsで再送する */
    retry: () => void;
}

export interface CloudBattleResolveDeps {
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
    try {
        const response = await deps.resolveCloudBattleAttempt(attemptId, actions);
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

    const runResolve = (attemptId: string, actions: readonly BattleAction[]): void => {
        setResolveState('syncing');
        void runCloudBattleResolve(attemptId, actions, { resolveCloudBattleAttempt, applyResolvedCloudBattle })
            .then((outcome) => {
                if (outcome.status === 'done') {
                    setGranted(outcome.granted);
                    setResolveState('done');
                } else {
                    setResolveState('error');
                }
            });
    };

    useEffect(() => {
        if (!shouldResolveBattle(activeBattle, resolvedAttemptIdRef.current)) return;
        const attemptId = activeBattle!.battleAttemptId!;
        resolvedAttemptIdRef.current = attemptId;
        runResolve(attemptId, activeBattle!.actions);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeBattle?.state.outcome, activeBattle?.rewardMode, activeBattle?.battleAttemptId, activeBattle?.actions]);

    // 新しい戦闘が始まったら（またはactiveBattleが閉じられたら）状態をリセットする
    useEffect(() => {
        if (!activeBattle || activeBattle.state.outcome === 'ongoing') {
            resolvedAttemptIdRef.current = null;
            setResolveState('idle');
            setGranted(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeBattle?.state.outcome, activeBattle?.battleAttemptId]);

    const retry = (): void => {
        if (!activeBattle?.battleAttemptId) return;
        runResolve(activeBattle.battleAttemptId, activeBattle.actions);
    };

    return { resolveState, granted, retry };
}
