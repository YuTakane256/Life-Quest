/**
 * クラウド書き込みoutboxのプラットフォーム非依存コントローラ（Gap A、Epic #473）。
 *
 * `syncOutbox.ts`（永続キュー・再送・依存解決の下位エンジン）の上に、
 * 「操作名→DB RPC / Edge Functionへのルーティング」「エンティティ単位の
 * 依存追跡（pendingEntityOps）」「認証ライフサイクルへの起動・停止配線」を
 * 載せたアプリケーション層。元はMobile専用実装（apps/mobile/src/platform/
 * cloudOutbox.ts）だったが、Webにも同じ書き込み経路を新設するにあたり
 * 共有ロジックをここへ集約した（プラットフォーム固有部分はRPCクライアント・
 * Edge Function呼び出し関数・ストレージのみで、呼び出し側が deps として注入する）。
 *
 * - opId = 冪等キー。二重再送してもサーバーのidempotency_keysが1回分に抑える
 * - ログイン中のuserIdのnamespaceに対してのみenqueue/drainする
 * - ログアウト時はdrainを中断（進行中opはpendingへ戻る）し、キューはディスクに残す
 * - 恒久失敗opの楽観更新の巻き戻しは、次のプルがサーバー正でストアを
 *   上書きすることで収束させる（v1方針）
 *
 * ## クラウドへ同期される操作
 * - タスク: 作成/削除（upsert_task 全項目 / delete_task）、
 *   完了/取消（complete_task EF / uncomplete_task）
 * - サブタスク: 追加/削除（upsert_subtask / delete_subtask）、
 *   完了/取消（complete_subtask EF / uncomplete_subtask）
 * - 習慣: 作成/削除（upsert_habit / delete_habit）、
 *   日次記録・メモ（set_habit_log、completed/memoの絶対状態upsert）、
 *   休養日（set_rest_day）、全達成ボーナス（claim_habit_bonus EF）
 * - 売却（sell_item EF）。バトル開始/決着・宝箱開封・装備合成は非決定論的
 *   なサーバー抽選を伴うため、このoutbox（fire-and-forget）ではなく
 *   `gameCloud.ts`のrequest/response方式で連携する（Web/Mobileとも配線済み）。
 *   これらの操作名（open_chest/synthesize_items/start_battle_attempt/
 *   resolve_battle_attempt）は意図的にEDGE_OPERATIONSへ含めない。誤って
 *   ここへenqueueされても`sendOperation`が「unknown operation」として
 *   即座に恒久失敗させるため、request/response側の専用エラー分岐
 *   （409→discard等）を迂回してoutbox経由で送られてしまうことはない
 * - プロフィール: キャラ名・アバター（update_character_profile）、称号
 *   （upsert_profile、display_name/avatarは未使用のためnull送信）
 * - 装備の装着状態（set_equipped_items、装着中アイテムID集合の絶対状態upsert）
 * ## まだ同期しない操作（後続Issueで拡張）
 * - 設定
 */
import { registerAuthLifecycleHooks } from './authLifecycle.ts';
import { cloudOutboxKey } from './cloudPull.ts';
import { createSyncOutbox, type OutboxOp, type OutboxSendResult, type SyncOutbox } from './syncOutbox.ts';
import type { RepositoryStorage } from './syncRepository.ts';
import { EdgeFunctionError, type EdgeFunctionInvoker } from './edgeFunctions.ts';

/** DB RPCとして送る操作（payloadに p_key として opId を注入する） */
export const RPC_OPERATIONS: ReadonlySet<string> = new Set([
    'upsert_task', 'delete_task', 'upsert_subtask', 'delete_subtask',
    'uncomplete_task', 'uncomplete_subtask', 'upsert_profile',
    'upsert_habit', 'delete_habit', 'set_rest_day', 'set_habit_log',
    'update_character_profile', 'set_equipped_items',
]);

/**
 * Edge Functionとして送る操作（bodyに idempotencyKey として opId を注入する）。
 * open_chest/synthesize_items/start_battle_attempt/resolve_battle_attemptは
 * 非決定論的なサーバー抽選を伴うrequest/response専用操作（`gameCloud.ts`）
 * のため、意図的にここへ含めない（詳細はファイル冒頭のコメント参照）。
 */
export const EDGE_OPERATIONS: ReadonlySet<string> = new Set([
    'complete_task', 'complete_subtask', 'claim_habit_bonus', 'sell_item',
]);

/** 4xx系（認可・検証エラー）は再送しても直らない恒久失敗として扱う */
function isPermanentStatus(status: number): boolean {
    return status >= 400 && status < 500;
}

/**
 * outboxが必要とするRPC呼び出しの最小interface。SDKのクライアント全体
 * （SupabaseClient等）をそのまま渡すのではなく、呼び出し側でこの形へ
 * 正規化して渡す（SDKの複雑なビルダー型をcoreへ持ち込まないため）。
 */
export interface CloudOutboxRpcClient {
    rpc: (
        name: string,
        params: Record<string, unknown>,
    ) => Promise<{ error: { message: string; code?: string } | null }>;
}

export interface CloudOutboxControllerDeps {
    storage: RepositoryStorage;
    /**
     * RPCクライアントを取得する（未ログイン・環境未設定ならnull）。
     * Mobileのreact-native依存等、プラットフォーム固有の遅延importは
     * ここに閉じ込める。
     */
    getRpcClient: () => Promise<CloudOutboxRpcClient | null> | CloudOutboxRpcClient | null;
    /** Edge Function呼び出し関数を取得する（未設定ならnull）。 */
    getEdgeInvoker: () => Promise<EdgeFunctionInvoker | null> | EdgeFunctionInvoker | null;
    /** 恒久失敗したopの楽観更新を巻き戻す（任意） */
    onPermanentFailure?: (op: OutboxOp) => void | Promise<void>;
}

export interface CloudOutboxController {
    /** 1opを送信先（DB RPC / Edge Function）へルーティングする。テストから直接検証できるようexport。 */
    sendOperation: (op: OutboxOp) => Promise<OutboxSendResult>;
    /**
     * クラウド操作をキューへ積む。未ログイン（outbox非アクティブ）なら false。
     * dependsOnEntityIds のエンティティの未完了opがまだキューにある場合、依存関係を張る。
     * trackEntityId を渡すと、このopをそのエンティティの最新の追跡opとして記録する。
     */
    enqueue: (
        operation: string,
        payload: Record<string, unknown>,
        options?: { dependsOnEntityIds?: string[]; trackEntityId?: string },
    ) => Promise<boolean>;
    /** クラウド同期が有効（ログイン済みでoutboxが動作中）かの同期判定。 */
    isActive: () => boolean;
    /** テスト用: 現在アクティブなoutbox。 */
    getActiveOutbox: () => SyncOutbox | null;
    /** 再接続・フォアグラウンド復帰などから再送を要求する。 */
    requestDrain: () => void;
    /**
     * 認証ライフサイクルへoutboxを配線する。アプリ起動時に一度だけ呼ぶ。
     * 戻り値の関数で解除する（進行中opはpendingへ戻し、キューはディスクに残す）。
     */
    registerHooks: () => () => void;
}

export function createCloudOutboxController(deps: CloudOutboxControllerDeps): CloudOutboxController {
    let activeOutbox: SyncOutbox | null = null;
    let activeUserId: string | null = null;
    /** キュー内で未送信の作成・更新系opの opId（エンティティID→opId。依存先解決に使う） */
    const pendingEntityOps = new Map<string, string>();

    async function sendOperation(op: OutboxOp): Promise<OutboxSendResult> {
        if (RPC_OPERATIONS.has(op.operation)) {
            const client = await deps.getRpcClient();
            if (!client) return { ok: false, permanent: false, error: 'supabase env not configured' };
            const { error } = await client.rpc(op.operation, { ...op.payload, p_key: op.opId });
            if (!error) return { ok: true };
            // PostgRESTのRPCエラー: DB関数のraiseは全て「再送で直らない」検証系として扱うが、
            // ネットワーク層の失敗（FetchError等）はcodeが付かないため一時エラーへ。
            const permanent = typeof error.code === 'string' && error.code.length > 0;
            return { ok: false, permanent, error: error.message };
        }

        if (EDGE_OPERATIONS.has(op.operation)) {
            const invoker = await deps.getEdgeInvoker();
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

    async function enqueue(
        operation: string,
        payload: Record<string, unknown>,
        options: { dependsOnEntityIds?: string[]; trackEntityId?: string } = {},
    ): Promise<boolean> {
        if (!activeOutbox) return false;
        const dependsOn: string[] = [];
        for (const entityId of options.dependsOnEntityIds ?? []) {
            const parentOpId = pendingEntityOps.get(entityId);
            if (parentOpId) dependsOn.push(parentOpId);
        }
        const op = await activeOutbox.enqueue({ operation, payload, dependsOn });
        if (op && options.trackEntityId) {
            pendingEntityOps.set(options.trackEntityId, op.opId);
        }
        return op !== null;
    }

    async function startOutbox(userId: string): Promise<void> {
        const outbox = createSyncOutbox({
            storage: deps.storage,
            storageKey: cloudOutboxKey(userId),
            send: sendOperation,
            onPermanentFailure: deps.onPermanentFailure,
        });
        await outbox.load();
        activeOutbox = outbox;
        activeUserId = userId;
        outbox.requestDrain(); // 前回セッションの残りを再送
    }

    return {
        sendOperation,
        enqueue,
        isActive: () => activeOutbox !== null,
        getActiveOutbox: () => activeOutbox,
        requestDrain: () => activeOutbox?.requestDrain(),
        registerHooks: () => {
            const unregister = registerAuthLifecycleHooks({
                onLogin: (userId) => {
                    if (activeUserId === userId && activeOutbox) return;
                    void (async () => {
                        await activeOutbox?.stop();
                        pendingEntityOps.clear();
                        await startOutbox(userId);
                    })();
                },
                onLogout: async () => {
                    // drain中の操作はpendingへ戻して中断（キューはディスクに残す）
                    await activeOutbox?.stop();
                    activeOutbox = null;
                    activeUserId = null;
                    pendingEntityOps.clear();
                },
            });
            return () => {
                void activeOutbox?.stop();
                activeOutbox = null;
                activeUserId = null;
                pendingEntityOps.clear();
                unregister();
            };
        },
    };
}
