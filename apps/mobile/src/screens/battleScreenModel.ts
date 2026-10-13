import { MAX_STAGE, hasPendingBattleResult, type BattleOutcome } from '@life-quest/core/battle';

export function getBattleResultView({ outcome, rewardMode, attemptId, resolveState, granted, xpReward, stage, busy }: {
    outcome: BattleOutcome;
    rewardMode: 'local' | 'cloud';
    attemptId: string | null;
    resolveState: 'idle' | 'syncing' | 'done' | 'error';
    granted: boolean | null;
    xpReward: number;
    stage: number;
    busy: boolean;
}) {
    const pending = hasPendingBattleResult(outcome, rewardMode, attemptId)
        || (rewardMode === 'cloud' && resolveState === 'syncing');
    let message = outcome === 'victory' ? `${xpReward} XP を獲得！` : 'レベルを上げて再挑戦しましょう！';
    if (rewardMode === 'cloud') {
        if (resolveState === 'error') message = outcome === 'victory' ? '報酬の同期に失敗しました。' : '結果の同期に失敗しました。';
        else if (pending) message = outcome === 'victory' ? '報酬を同期中…' : '結果を同期中…';
        else if (outcome === 'victory') message = granted === true ? `${xpReward} XP を獲得！`
            : granted === false ? '同期済み（既に付与済みです）' : '同期済み';
    }
    return {
        message,
        canContinue: outcome !== 'ongoing' && !pending && !busy,
        canResend: resolveState === 'error' && attemptId !== null && !busy,
        nextStage: Math.min(stage + 1, MAX_STAGE),
        nextLabel: stage < MAX_STAGE ? '次へ' : '再挑戦',
    };
}
