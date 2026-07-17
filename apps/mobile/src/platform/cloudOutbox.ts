/**
 * Mobileのオフラインキュー（#505、ADR-004/009）。
 *
 * ルーティング表・エンティティ依存追跡・認証ライフサイクル配線は
 * `@life-quest/core/cloudOutboxController`（Gap A、Epic #473でWebと共有化）に
 * 集約されている。このファイルはMobile固有の依存（AsyncStorage、
 * react-native依存のsupabase/edgeFunctionsクライアントの遅延import）を
 * 注入する薄いアダプタ。
 *
 * react-native/expo-secure-store依存のモジュールをストアのユニットテスト
 * （node/jsdom）が読み込めないため、送信時にのみ遅延importする。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    createCloudOutboxController,
    EDGE_OPERATIONS,
    RPC_OPERATIONS,
    type CloudOutboxRpcClient,
} from '@life-quest/core/cloudOutboxController';
import type { SyncOutbox } from '@life-quest/core/syncOutbox';

export { EDGE_OPERATIONS, RPC_OPERATIONS };

const controller = createCloudOutboxController({
    storage: AsyncStorage,
    getRpcClient: async (): Promise<CloudOutboxRpcClient | null> => {
        const { getMobileSupabaseClient } = await import('./supabase');
        const client = getMobileSupabaseClient();
        if (!client) return null;
        return {
            rpc: async (name, params) => {
                const { error } = await client.rpc(name, params);
                return { error };
            },
        };
    },
    getEdgeInvoker: async () => {
        const { getMobileEdgeFunctionInvoker } = await import('./edgeFunctions');
        return getMobileEdgeFunctionInvoker();
    },
    onPermanentFailure: (op) => {
        // 楽観更新の巻き戻しは次のプルのサーバー正で収束させる（v1）
        console.warn(`outbox op failed permanently: ${op.operation} (${op.opId})`);
    },
});

/** 1opを送信先（DB RPC / Edge Function）へルーティングする。テストから直接検証できるようexport。 */
export const sendOperation = controller.sendOperation;

/** テスト用: 現在アクティブなoutbox。 */
export function getActiveMobileOutbox(): SyncOutbox | null {
    return controller.getActiveOutbox();
}

/**
 * クラウド同期が有効（ログイン済みでoutboxが動作中）かの同期判定。
 * ストアはこれで「サーバー権威に任せる処理」と「ローカル処理」を分岐する
 * （例: 繰り返し次回生成はクラウド有効時はサーバーが行う）。
 */
export function isCloudOutboxActive(): boolean {
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
export function registerMobileOutboxHooks(): () => void {
    return controller.registerHooks();
}
