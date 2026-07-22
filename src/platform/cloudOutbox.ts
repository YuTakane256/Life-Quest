/**
 * Webのクラウド書き込みoutbox（Gap A、Epic #473）。
 *
 * ルーティング表・エンティティ依存追跡・認証ライフサイクル配線は
 * `@life-quest/core/cloudOutboxController`（Mobileの`cloudOutbox.ts`と共有）に
 * 集約されている。このファイルはWeb固有の依存（localStorageアダプタ、
 * `supabase.ts`/`edgeFunctions.ts`のクライアント）を注入する薄いアダプタ。
 *
 * ## 現時点でクラウドへ同期されるWeb操作
 * - タスク: 作成/削除（upsert_task 全項目 / delete_task）、
 *   完了/取消（complete_task EF / uncomplete_task）
 * - サブタスク: 追加/削除（upsert_subtask / delete_subtask）、
 *   完了/取消（complete_subtask EF / uncomplete_subtask）
 * - 習慣: 作成/削除（upsert_habit / delete_habit）、
 *   日次記録・メモ（set_habit_log、completed/memoの絶対状態upsert）、
 *   休養日（set_rest_day）、全達成ボーナス（claim_habit_bonus EF）
 * - ゲーム操作: バトル開始/決着（`gameCloud.ts`のrequest/response方式、
 *   outbox経由ではない）、宝箱開封（同）、装備合成（同）、売却（sell_item EF、
 *   このoutbox経由）
 * - 設定（upsert_user_settings、themeMode/motionMode/notificationsEnabled/
 *   habitReminderHourの4項目のみ。集約は`src/platform/settingsSync.ts`）
 */
import {
    createCloudOutboxController,
    EDGE_OPERATIONS,
    RPC_OPERATIONS,
    type CloudOutboxRpcClient,
} from '@life-quest/core/cloudOutboxController';
import type { SyncOutbox } from '@life-quest/core/syncOutbox';
import { getPlatformStorageAdapter } from './storage';
import { getWebSupabaseClient } from './supabase';
import { getWebEdgeFunctionInvoker } from './edgeFunctions';

export { EDGE_OPERATIONS, RPC_OPERATIONS };

const controller = createCloudOutboxController({
    storage: getPlatformStorageAdapter(),
    getRpcClient: (): CloudOutboxRpcClient | null => {
        const client = getWebSupabaseClient();
        if (!client) return null;
        return {
            rpc: async (name, params) => {
                const { error } = await client.rpc(name, params);
                return { error };
            },
        };
    },
    getEdgeInvoker: () => getWebEdgeFunctionInvoker(),
    onPermanentFailure: (op) => {
        // 楽観更新の巻き戻しは次のプルのサーバー正で収束させる（v1、Mobileと同方針）
        console.warn(`outbox op failed permanently: ${op.operation} (${op.opId})`);
    },
});

/** 1opを送信先（DB RPC / Edge Function）へルーティングする。テストから直接検証できるようexport。 */
export const sendOperation = controller.sendOperation;

/** テスト用: 現在アクティブなoutbox。 */
export function getActiveWebOutbox(): SyncOutbox | null {
    return controller.getActiveOutbox();
}

/**
 * クラウド同期が有効（ログイン済みでoutboxが動作中）かの同期判定。
 * ストアはこれで「サーバー権威に任せる処理」と「ローカル処理」を分岐する
 * （例: 繰り返し次回生成はクラウド有効時はサーバーが行う）。
 */
export function isWebCloudOutboxActive(): boolean {
    return controller.isActive();
}

/**
 * クラウド操作をキューへ積む。未ログイン（outbox非アクティブ）なら false。
 * dependsOnEntityIds のエンティティの作成opがまだキューにある場合、依存関係を張る。
 * trackEntityId を渡すと、このopをそのエンティティの作成opとして記録する。
 */
export function enqueueCloudOperation(
    operation: string,
    payload: Record<string, unknown>,
    options: { dependsOnEntityIds?: string[]; trackEntityId?: string } = {},
): Promise<boolean> {
    return controller.enqueue(operation, payload, options);
}

/** 再接続・フォアグラウンド復帰などから再送を要求する。 */
export function requestOutboxDrain(): void {
    controller.requestDrain();
}

/** 認証ライフサイクルへoutboxを配線する。アプリ起動時に一度だけ呼ぶ。 */
export function registerWebOutboxHooks(): () => void {
    return controller.registerHooks();
}
