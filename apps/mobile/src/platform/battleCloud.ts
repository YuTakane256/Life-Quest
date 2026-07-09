import type { BattleAction, BattleActors } from '@life-quest/core/battle';
import { getMobileEdgeFunctionInvoker } from './edgeFunctions';
import { createMobileId } from '../utils/createMobileId';

interface StartBattleAttemptResponse {
    battle_attempt_id: string;
    enemy_snapshot: {
        stage: number;
        name: string;
        maxHp: number;
        attack: number;
        defense: number;
        xpReward: number;
    };
    player_snapshot: {
        name: string;
        level: number;
        attack: number;
        defense: number;
        maxHp: number;
    };
}

export interface CloudBattleAttempt {
    battleAttemptId: string;
    actors: BattleActors;
}

export interface ResolveBattleAttemptResponse {
    outcome: 'victory' | 'defeat';
    granted: boolean;
    already_resolved?: boolean;
}

export async function startCloudBattleAttempt(stage: number): Promise<CloudBattleAttempt | null> {
    const invoker = getMobileEdgeFunctionInvoker();
    if (!invoker) return null;
    const response = await invoker<StartBattleAttemptResponse>('start_battle_attempt', {
        stage,
        idempotencyKey: createMobileId(),
    });
    return {
        battleAttemptId: response.battle_attempt_id,
        actors: {
            player: {
                attack: response.player_snapshot.attack,
                defense: response.player_snapshot.defense,
                maxHp: response.player_snapshot.maxHp,
            },
            enemy: response.enemy_snapshot,
            playerLevel: response.player_snapshot.level,
            playerName: response.player_snapshot.name,
        },
    };
}

export async function resolveCloudBattleAttempt(
    battleAttemptId: string,
    actions: readonly BattleAction[],
): Promise<ResolveBattleAttemptResponse> {
    const invoker = getMobileEdgeFunctionInvoker();
    if (!invoker) throw new Error('クラウド接続が利用できません');
    return await invoker<ResolveBattleAttemptResponse>('resolve_battle_attempt', {
        battleAttemptId,
        actions,
        idempotencyKey: createMobileId(),
    });
}
