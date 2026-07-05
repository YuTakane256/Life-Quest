/**
 * resolve_battle_attempt（#502 / ADR-010の核心）。
 * クライアントが提出した行動列を、start時にサーバーが確定したスナップショットを
 * 初期値としてcore replayBattleで独立に再計算し、勝敗を確定する。
 * クライアントの「勝った」という自己申告は一切信用しない。
 * 冪等性はbattle_attempt_id単位: resolved済みattemptへの再送信は既存結果を返すだけで
 * 報酬は付与されない。新しい挑戦（新しいattempt_id）は毎回正規の報酬機会になる。
 */
import { replayBattle, type BattleAction } from '../../../packages/core/src/battle.ts';
import { BadRequestError, callApply, json, NotFoundError, requireString, serveGameFunction } from '../_shared/handler.ts';

interface AttemptRow {
    id: string;
    status: string;
    outcome: string | null;
    enemy_snapshot: {
        stage: number; name: string; maxHp: number;
        attack: number; defense: number; xpReward: number;
    };
    player_snapshot: {
        name: string; level: number;
        attack: number; defense: number; maxHp: number;
    };
}

function parseActions(raw: unknown): BattleAction[] {
    if (!Array.isArray(raw)) throw new BadRequestError('invalid_actions');
    return raw.map((entry): BattleAction => {
        if (typeof entry !== 'object' || entry === null) throw new BadRequestError('invalid_actions');
        const action = entry as { type?: unknown; skillId?: unknown };
        if (action.type === 'attack') return { type: 'attack' };
        if (action.type === 'skill' && typeof action.skillId === 'string') {
            return { type: 'skill', skillId: action.skillId };
        }
        throw new BadRequestError('invalid_actions');
    });
}

serveGameFunction(async (ctx) => {
    const attemptId = requireString(ctx.body, 'battleAttemptId');
    const idempotencyKey = requireString(ctx.body, 'idempotencyKey');
    const actions = parseActions(ctx.body.actions);

    const { data: attempt, error } = await ctx.service
        .from('battle_attempts')
        .select('id, status, outcome, enemy_snapshot, player_snapshot')
        .eq('id', attemptId)
        .eq('user_id', ctx.userId)
        .single<AttemptRow>();
    if (error || !attempt) throw new NotFoundError();

    if (attempt.status !== 'in_progress') {
        // 同一attemptの結果二重送信（ADR-010）: 既存の確定結果を返すのみ
        return json(200, { outcome: attempt.outcome, granted: false, already_resolved: true });
    }

    // サーバー側の独立再計算（core共有ロジック。クライアント申告の勝敗は受け取らない）
    const replay = replayBattle(
        {
            player: {
                attack: attempt.player_snapshot.attack,
                defense: attempt.player_snapshot.defense,
                maxHp: attempt.player_snapshot.maxHp,
            },
            enemy: attempt.enemy_snapshot,
            playerLevel: attempt.player_snapshot.level,
            playerName: attempt.player_snapshot.name,
        },
        actions,
    );

    if (replay.hadInvalidAction || replay.outcome === 'ongoing') {
        // 不正な行動列 or 決着に至らない行動列。attemptはin_progressのまま残す
        return json(422, { error: 'actions_do_not_resolve_battle' });
    }

    return callApply(ctx.service, 'resolve_battle_attempt_apply', {
        p_user_id: ctx.userId,
        p_attempt_id: attemptId,
        p_outcome: replay.outcome,
        p_xp: replay.outcome === 'victory' ? attempt.enemy_snapshot.xpReward : 0,
        p_key: idempotencyKey,
    });
});
