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
 * 適用してから結果を返す（呼び出し元は返り値でstate更新するだけでよい）。
 * Reactの状態管理から切り離した純粋な非同期関数として抽出し、
 * `useCloudBattleResolve.test.ts`から直接テストできるようにする。
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

export function useCloudBattleResolve(): UseCloudBattleResolveResult {
    const battle = useGameStore((state) => state.battle);
    const applyResolvedCloudBattle = useGameStore((state) => state.applyResolvedCloudBattle);
    const [resolveState, setResolveState] = useState<CloudBattleResolveState>('idle');
    const [granted, setGranted] = useState<boolean | null>(null);
    const resolvedAttemptIdRef = useRef<string | null>(null);

    const runResolve = (attemptId: string, actions: typeof battle.actions): void => {
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
        if (battle.status !== 'victory' && battle.status !== 'defeat') return;
        if (battle.rewardMode !== 'cloud' || !battle.battleAttemptId) return;
        if (resolvedAttemptIdRef.current === battle.battleAttemptId) return;
        resolvedAttemptIdRef.current = battle.battleAttemptId;
        runResolve(battle.battleAttemptId, battle.actions);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [battle.status, battle.rewardMode, battle.battleAttemptId, battle.actions]);

    // 新しい戦闘が始まったら状態をリセットする
    useEffect(() => {
        if (battle.status === 'fighting') {
            resolvedAttemptIdRef.current = null;
            setResolveState('idle');
            setGranted(null);
        }
    }, [battle.status, battle.battleAttemptId]);

    const retry = (): void => {
        if (!battle.battleAttemptId) return;
        runResolve(battle.battleAttemptId, battle.actions);
    };

    return { resolveState, granted, retry };
}
