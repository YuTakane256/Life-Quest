/**
 * Mobileのオフラインキュー（#505、ADR-004/009）。
 *
 * core createSyncOutbox を user_id 別 namespace（cloudOutboxKey）で駆動し、
 * DB RPC / Edge Function への送信を担う。
 * - opId = 冪等キー。二重再送してもサーバーのidempotency_keysが1回分に抑える
 * - ログイン中のuserIdのnamespaceに対してのみenqueue/drainする
 * - ログアウト時はdrainを中断（進行中opはpendingへ戻る）し、キューはディスクに残す
 * - 恒久失敗opの楽観更新の巻き戻しは、次のプル（#504）がサーバー正で
 *   ストアを上書きすることで収束させる（v1方針）
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { cloudOutboxKey } from '@life-quest/core/cloudPull';
import { createSyncOutbox, type OutboxOp, type OutboxSendResult, type SyncOutbox } from '@life-quest/core/syncOutbox';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';

/** DB RPCとして送る操作（payloadに p_key として opId を注入する） */
const RPC_OPERATIONS = new Set([
    'upsert_task', 'delete_task', 'upsert_subtask',
    'uncomplete_task', 'uncomplete_subtask', 'upsert_profile',
]);

/** Edge Functionとして送る操作（bodyに idempotencyKey として opId を注入する） */
const EDGE_OPERATIONS = new Set([
    'complete_task', 'complete_subtask', 'claim_habit_bonus',
    'sell_item', 'synthesize_items', 'open_chest',
    'start_battle_attempt', 'resolve_battle_attempt',
]);

/** 4xx系（認可・検証エラー）は再送しても直らない恒久失敗として扱う */
function isPermanentStatus(status: number): boolean {
    return status >= 400 && status < 500;
}

async function sendOperation(op: OutboxOp): Promise<OutboxSendResult> {
    // supabase/edgeFunctionsはexpo-secure-store経由でreact-nativeへ届くため、
    // ストアのユニットテスト（node/jsdom）をFlow構文のparse失敗から守るべく
    // 送信時にのみ遅延importする。
    const { getMobileSupabaseClient } = await import('./supabase');
    const client = getMobileSupabaseClient();
    if (!client) return { ok: false, permanent: false, error: 'supabase env not configured' };

    if (RPC_OPERATIONS.has(op.operation)) {
        const { error } = await client.rpc(op.operation, { ...op.payload, p_key: op.opId });
        if (!error) return { ok: true };
        // PostgRESTのRPCエラー: DB関数のraiseは全て「再送で直らない」検証系として扱うが、
        // ネットワーク層の失敗（FetchError等）はcodeが付かないため一時エラーへ。
        const permanent = typeof error.code === 'string' && error.code.length > 0;
        return { ok: false, permanent, error: error.message };
    }

    if (EDGE_OPERATIONS.has(op.operation)) {
        const { getMobileEdgeFunctionInvoker } = await import('./edgeFunctions');
        const invoker = getMobileEdgeFunctionInvoker();
        if (!invoker) return { ok: false, permanent: false, error: 'edge functions not configured' };
        try {
            await invoker(op.operation, { ...op.payload, idempotencyKey: op.opId });
            return { ok: true };
        } catch (error) {
            if (error instanceof EdgeFunctionError && typeof error.status === 'number') {
                return { ok: false, permanent: isPermanentStatus(error.status), error: error.message };
            }
            // 未認証・ネットワーク断は再送可能（セッション回復後のdrainで再試行）
            return { ok: false, permanent: false, error: error instanceof Error ? error.message : 'network error' };
        }
    }

    return { ok: false, permanent: true, error: `unknown operation: ${op.operation}` };
}

let activeOutbox: SyncOutbox | null = null;
let activeUserId: string | null = null;
/** キュー内で未送信のタスクupsertの opId（サブタスクの依存先解決に使う） */
const pendingTaskOps = new Map<string, string>();

/** テスト用: 現在アクティブなoutbox。 */
export function getActiveMobileOutbox(): SyncOutbox | null {
    return activeOutbox;
}

/**
 * クラウド操作をキューへ積む。未ログイン（outbox非アクティブ）なら false。
 * taskIdを渡すと、そのタスクのupsertがまだキューにある場合に依存関係を張る。
 */
export async function enqueueCloudOperation(
    operation: string,
    payload: Record<string, unknown>,
    options: { dependsOnTaskId?: string; trackTaskId?: string } = {},
): Promise<boolean> {
    if (!activeOutbox) return false;
    const dependsOn: string[] = [];
    if (options.dependsOnTaskId) {
        const parentOpId = pendingTaskOps.get(options.dependsOnTaskId);
        if (parentOpId) dependsOn.push(parentOpId);
    }
    const op = await activeOutbox.enqueue({ operation, payload, dependsOn });
    if (op && options.trackTaskId) {
        pendingTaskOps.set(options.trackTaskId, op.opId);
    }
    return op !== null;
}

/** 再接続・フォアグラウンド復帰などから再送を要求する。 */
export function requestOutboxDrain(): void {
    activeOutbox?.requestDrain();
}

async function startOutbox(userId: string): Promise<void> {
    const outbox = createSyncOutbox({
        storage: AsyncStorage,
        storageKey: cloudOutboxKey(userId),
        send: sendOperation,
        onPermanentFailure: (op) => {
            // 楽観更新の巻き戻しは次のプルのサーバー正で収束させる（v1）
            console.warn(`outbox op failed permanently: ${op.operation} (${op.opId})`);
        },
    });
    await outbox.load();
    activeOutbox = outbox;
    activeUserId = userId;
    outbox.requestDrain(); // 前回セッションの残りを再送
}

/** 認証ライフサイクルへoutboxを配線する。アプリ起動時に一度だけ呼ぶ。 */
export function registerMobileOutboxHooks(): () => void {
    const unregister = registerAuthLifecycleHooks({
        onLogin: (userId) => {
            if (activeUserId === userId && activeOutbox) return;
            void (async () => {
                await activeOutbox?.stop();
                pendingTaskOps.clear();
                await startOutbox(userId);
            })();
        },
        onLogout: async () => {
            // drain中の操作はpendingへ戻して中断（キューはディスクに残す）
            await activeOutbox?.stop();
            activeOutbox = null;
            activeUserId = null;
            pendingTaskOps.clear();
        },
    });
    return () => {
        void activeOutbox?.stop();
        activeOutbox = null;
        activeUserId = null;
        pendingTaskOps.clear();
        unregister();
    };
}
