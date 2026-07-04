/**
 * complete_task（#511スパイク最小版）。
 *
 * ADR-002 案Bの実証: ゲームルールの数値は @life-quest/core を**直接import**して
 * 算出し（ここでは優先度mediumのサブタスクXP=10を固定利用）、DBには
 * ルール計算を持たない SECURITY DEFINER 関数 complete_task_authoritative を
 * 1回呼ぶだけにする。トランザクション・冪等性・所有者検証はDB関数側の責務。
 *
 * ADR-007: user_id はJWTからのみ導出。ボディの user_id は一切読まない。
 */
import { getSubtaskRewardXp } from '../../../packages/core/src/tasks.ts';
import { createServiceClient, UnauthorizedError, verifyUser } from '../_shared/auth.ts';

interface CompleteTaskBody {
    taskId?: string;
    idempotencyKey?: string;
}

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req: Request) => {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    let userId: string;
    try {
        userId = await verifyUser(req);
    } catch (error) {
        if (error instanceof UnauthorizedError) return json(401, { error: 'unauthorized' });
        return json(500, { error: 'auth_failure' });
    }

    let body: CompleteTaskBody;
    try {
        body = await req.json() as CompleteTaskBody;
    } catch {
        return json(400, { error: 'invalid_json' });
    }
    if (!body.taskId || !body.idempotencyKey) {
        return json(400, { error: 'missing_fields' });
    }

    // core直接importの実証: XP額はcoreの共有ルールから算出する（スパイクではmedium固定）
    const xp = getSubtaskRewardXp('medium');

    const service = createServiceClient();
    const { data, error } = await service.rpc('complete_task_authoritative', {
        p_user_id: userId, // JWT由来のみ（ボディのuser_idは存在しても無視される）
        p_task_id: body.taskId,
        p_xp: xp,
        p_key: body.idempotencyKey,
    });

    if (error) {
        const forbidden = error.message.includes('not_found_or_forbidden');
        return json(forbidden ? 404 : 500, { error: error.message });
    }
    return json(200, data);
});
