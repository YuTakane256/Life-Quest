/**
 * Webのクラウド書き込みoutbox（Gap A、Epic #473）テスト。
 * ルーティング・依存追跡本体は @life-quest/core/cloudOutboxController 側で
 * 検証済みのため、ここではWeb固有の配線（storage/RPC/EF invokerの注入、
 * 認証ライフサイクルへの起動停止）のみを確認する。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import {
    EDGE_OPERATIONS,
    RPC_OPERATIONS,
    getActiveWebOutbox,
    isWebCloudOutboxActive,
    registerWebOutboxHooks,
    sendOperation,
} from './cloudOutbox';
import type { OutboxOp } from '@life-quest/core/syncOutbox';

function makeOp(operation: string, payload: Record<string, unknown> = {}): OutboxOp {
    return {
        opId: 'op-1',
        operation,
        payload,
        dependsOn: [],
        baseVersion: null,
        status: 'pending',
        enqueuedAt: '2026-07-17T00:00:00Z',
        optimisticSnapshot: null,
    };
}

describe('registerWebOutboxHooks', () => {
    afterEach(() => {
        resetAuthLifecycleHooks();
    });

    it('ログインでoutboxが起動し、ログアウトで停止する', async () => {
        const unregister = registerWebOutboxHooks();

        expect(isWebCloudOutboxActive()).toBe(false);
        await notifyLogin('user-1');
        await vi.waitFor(() => expect(isWebCloudOutboxActive()).toBe(true));
        expect(getActiveWebOutbox()).not.toBeNull();

        await notifyLogout();
        expect(isWebCloudOutboxActive()).toBe(false);

        unregister();
    });

    it('解除後はログイン通知に反応しない', async () => {
        const unregister = registerWebOutboxHooks();
        unregister();
        await notifyLogin('user-1');
        expect(isWebCloudOutboxActive()).toBe(false);
    });
});

describe('sendOperation（送信ルーティング）', () => {
    it('Supabase環境が未設定なら一時エラーとして報告される（キューに残り、次回再送で回復できる）', async () => {
        const rpcResult = await sendOperation(makeOp('upsert_task', { p_id: 't1' }));
        expect(rpcResult).toEqual({ ok: false, permanent: false, failureKind: 'network', error: 'supabase env not configured' });

        const edgeResult = await sendOperation(makeOp('complete_task', { taskId: 't1' }));
        expect(edgeResult).toEqual({ ok: false, permanent: false, failureKind: 'network', error: 'edge functions not configured' });
    });

    it('未知の操作は恒久失敗として報告される', async () => {
        const result = await sendOperation(makeOp('bogus_operation', {}));
        expect(result).toEqual({ ok: false, permanent: true, failureKind: 'unsupported', error: 'unknown operation: bogus_operation' });
    });

    it('タスク・習慣ストアがenqueueする全操作が送信先を持つ（unknown operationにならない）', () => {
        const storeOperations = [
            'upsert_task', 'delete_task', 'uncomplete_task',
            'upsert_subtask', 'delete_subtask', 'uncomplete_subtask',
            'complete_task', 'complete_subtask',
            'upsert_habit', 'delete_habit', 'set_rest_day', 'set_habit_log', 'claim_habit_bonus',
        ];
        for (const operation of storeOperations) {
            expect(
                RPC_OPERATIONS.has(operation) || EDGE_OPERATIONS.has(operation),
                `${operation} has no send route`,
            ).toBe(true);
        }
    });
});
