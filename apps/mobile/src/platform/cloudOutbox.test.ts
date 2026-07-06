/**
 * #505 cloudOutboxの送信ルーティングテスト。
 * ストアがenqueueする全操作が送信先を持つこと（unknown operationで
 * 恒久失敗しないこと）と、delete_subtask がSupabase RPCとして
 * 送られることを検証する。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
    },
}));

const rpcCalls: { operation: string; params: Record<string, unknown> }[] = [];

vi.mock('./supabase', () => ({
    getMobileSupabaseClient: () => ({
        rpc: vi.fn(async (operation: string, params: Record<string, unknown>) => {
            rpcCalls.push({ operation, params });
            return { data: {}, error: null };
        }),
    }),
}));

vi.mock('./edgeFunctions', () => ({
    getMobileEdgeFunctionInvoker: () => vi.fn(async () => ({})),
}));

import { EDGE_OPERATIONS, RPC_OPERATIONS, sendOperation } from './cloudOutbox';
import type { OutboxOp } from '@life-quest/core/syncOutbox';

function makeOp(operation: string, payload: Record<string, unknown>): OutboxOp {
    return {
        opId: 'op-1',
        operation,
        payload,
        dependsOn: [],
        baseVersion: null,
        status: 'pending',
        enqueuedAt: '2026-07-06T00:00:00Z',
        optimisticSnapshot: null,
    };
}

describe('cloudOutboxの送信ルーティング（#505）', () => {
    beforeEach(() => {
        rpcCalls.length = 0;
    });

    it('delete_subtaskはSupabase RPCとして送られ、opIdがp_keyになる', async () => {
        const result = await sendOperation(makeOp('delete_subtask', { p_id: 'sub-1' }));
        expect(result).toEqual({ ok: true });
        expect(rpcCalls).toEqual([
            { operation: 'delete_subtask', params: { p_id: 'sub-1', p_key: 'op-1' } },
        ]);
    });

    it('タスクストアがenqueueする全操作が送信先を持つ（unknown operationにならない）', () => {
        const storeOperations = [
            'upsert_task', 'delete_task', 'uncomplete_task',
            'upsert_subtask', 'delete_subtask', 'uncomplete_subtask',
            'complete_task', 'complete_subtask',
        ];
        for (const operation of storeOperations) {
            expect(
                RPC_OPERATIONS.has(operation) || EDGE_OPERATIONS.has(operation),
                `${operation} has no send route`,
            ).toBe(true);
        }
    });

    it('未知の操作は恒久失敗として報告される（キューに滞留しない）', async () => {
        const result = await sendOperation(makeOp('bogus_operation', {}));
        expect(result).toEqual({
            ok: false,
            permanent: true,
            error: 'unknown operation: bogus_operation',
        });
    });
});
