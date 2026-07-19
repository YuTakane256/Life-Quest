/**
 * バトル開始をクラウド権威で行う（可能な場合）。
 *
 * `startCloudBattleAttempt(stage)`を試行し、成功（非null）ならサーバーの
 * スナップショットで`startCloudBattle`（`rewardMode: 'cloud'`）を、
 * 未ログイン・Edge Function未設定（null）またはネットワークエラー等の
 * 例外時はローカル`startBattle`（`rewardMode: 'local'`）へフォールバック
 * する（Mobileの`MapScreen.tsx`のhandleStartと対称のパターン）。
 *
 * `isStarting`中の呼び出しは二重開始防止のため無視する。
 */
import { useState } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { startCloudBattleAttempt } from '../platform/gameCloud';
import type { BattlePlayerSnapshot, Enemy } from '../types';

export interface UseCloudBattleStartResult {
    isStarting: boolean;
    startStage: (stage: number) => Promise<void>;
}

export function useCloudBattleStart(): UseCloudBattleStartResult {
    const startBattle = useGameStore((state) => state.startBattle);
    const startCloudBattle = useGameStore((state) => state.startCloudBattle);
    const [isStarting, setIsStarting] = useState(false);

    const startStage = async (stage: number): Promise<void> => {
        if (isStarting) return;
        setIsStarting(true);
        try {
            const attempt = await startCloudBattleAttempt(stage);
            if (!attempt) {
                startBattle(stage);
                return;
            }
            const playerSnapshot: BattlePlayerSnapshot = {
                attack: attempt.actors.player.attack,
                defense: attempt.actors.player.defense,
                maxHp: attempt.actors.player.maxHp,
                level: attempt.actors.playerLevel,
                name: attempt.actors.playerName,
            };
            const enemy: Enemy = { ...attempt.actors.enemy, hp: attempt.actors.enemy.maxHp };
            startCloudBattle(stage, attempt.battleAttemptId, playerSnapshot, enemy);
        } catch {
            // クラウド接続エラー時はローカル計算にフォールバックする
            startBattle(stage);
        } finally {
            setIsStarting(false);
        }
    };

    return { isStarting, startStage };
}
