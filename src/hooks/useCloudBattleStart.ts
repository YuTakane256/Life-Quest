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
import { startCloudBattleAttempt, type CloudBattleAttempt } from '../platform/gameCloud';
import type { BattlePlayerSnapshot, Enemy } from '../types';

export interface UseCloudBattleStartResult {
    isStarting: boolean;
    startStage: (stage: number) => Promise<void>;
}

export interface CloudBattleStartDeps {
    startCloudBattleAttempt: (stage: number) => Promise<CloudBattleAttempt | null>;
    startBattle: (stage: number) => void;
    startCloudBattle: (
        stage: number,
        battleAttemptId: string,
        playerSnapshot: BattlePlayerSnapshot,
        enemy: Enemy,
    ) => void;
}

/**
 * `startStage`の判断ロジック本体（クラウド試行→null/例外ならローカル
 * フォールバック）。Reactの状態管理から切り離した純粋な非同期関数として
 * 抽出し、`useCloudBattleStart.test.ts`から直接テストできるようにする
 * （`renderHook`基盤が無いため、フックはこれを呼ぶだけの薄い配線にする）。
 */
export async function runCloudBattleStart(stage: number, deps: CloudBattleStartDeps): Promise<void> {
    try {
        const attempt = await deps.startCloudBattleAttempt(stage);
        if (!attempt) {
            deps.startBattle(stage);
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
        deps.startCloudBattle(stage, attempt.battleAttemptId, playerSnapshot, enemy);
    } catch {
        // クラウド接続エラー時はローカル計算にフォールバックする
        deps.startBattle(stage);
    }
}

export function useCloudBattleStart(): UseCloudBattleStartResult {
    const startBattle = useGameStore((state) => state.startBattle);
    const startCloudBattle = useGameStore((state) => state.startCloudBattle);
    const [isStarting, setIsStarting] = useState(false);

    const startStage = async (stage: number): Promise<void> => {
        if (isStarting) return;
        setIsStarting(true);
        try {
            await runCloudBattleStart(stage, { startCloudBattleAttempt, startBattle, startCloudBattle });
        } finally {
            setIsStarting(false);
        }
    };

    return { isStarting, startStage };
}
