/**
 * #505 cloudOutboxの送信ルーティングテスト。
 * ストアがenqueueする全操作が送信先を持つこと（unknown operationで
 * 恒久失敗しないこと）と、delete_subtask がSupabase RPCとして
 * 送られることを検証する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
    },
}));

const rpcCalls: { operation: string; params: Record<string, unknown> }[] = [];
const headerCalls: unknown[][] = [];
const session = vi.hoisted(() => ({ user: 'user-a', token: 'token-a', status: 200 }));

vi.mock('./supabase', () => ({
    getMobileSupabaseClient: () => ({
        auth: { getSession: async () => ({ data: { session: {
            access_token: session.token, user: { id: session.user },
        } }, error: null }) },
        rpc: vi.fn((operation: string, params: Record<string, unknown>) => {
            rpcCalls.push({ operation, params });
            return { setHeader: async (...args: unknown[]) => {
                headerCalls.push(args);
                return { data: {}, error: session.status >= 400 ? { message: 'private-rpc-detail', code: String(session.status) } : null, status: session.status };
            } };
        }),
    }),
}));

vi.mock('./edgeFunctions', () => ({
    getMobileEdgeFunctionInvoker: () => vi.fn(async () => ({})),
}));

import { EDGE_OPERATIONS, RPC_OPERATIONS, sendOperation, registerMobileOutboxHooks,
    enqueueCloudOperation, getActiveMobileOutbox, retryPendingOutbox } from './cloudOutbox';
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
        session.status = 200;
        rpcCalls.length = 0;
        headerCalls.length = 0;
        session.user = 'user-a'; session.token = 'token-a';
    });
    afterEach(() => resetAuthLifecycleHooks());

    it('Mobileでも別ユーザーのJWTを拒否し、元のユーザーの認証回復で同じIDを再送する', async () => {
        const unregister = registerMobileOutboxHooks();
        await notifyLogin('user-a');
        session.user = 'user-b'; session.token = 'token-b';
        await enqueueCloudOperation('upsert_task', { p_id: 'a-task' });
        const outbox = getActiveMobileOutbox()!;
        await outbox.flush();
        const id = outbox.snapshot()[0].opId;
        expect(outbox.snapshot()[0].failure?.kind).toBe('auth-required');
        expect(rpcCalls).toEqual([]);
        session.user = 'user-a'; session.token = 'a-new-token';
        await retryPendingOutbox();
        expect(rpcCalls).toEqual([]);
        await notifyLogin('user-a');
        expect(headerCalls).toEqual([['Authorization', 'Bearer a-new-token']]);
        expect(rpcCalls[0].params.p_key).toBe(id);
        expect(outbox.snapshot()).toEqual([]);
        await notifyLogout();
        unregister();
    });

    it('delete_subtaskはSupabase RPCとして送られ、opIdがp_keyになる', async () => {
        const result = await sendOperation(makeOp('delete_subtask', { p_id: 'sub-1' }));
        expect(result).toEqual({ ok: true });
        expect(headerCalls).toEqual([['Authorization', 'Bearer token-a']]);
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
            failureKind: 'unsupported',
            error: 'unknown operation: bogus_operation',
        });
    });
    it('恒久失敗の診断へ操作IDを出さず、キューのIDとpayloadを保持する', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const unregister = registerMobileOutboxHooks();
        try {
            await notifyLogin('user-a'); session.status = 403;
            await enqueueCloudOperation('delete_task', { p_id: 'private-row-id' });
            const outbox = getActiveMobileOutbox()!; await outbox.flush();
            const [op] = outbox.snapshot();
            expect(op).toMatchObject({ status: 'failed', operation: 'delete_task', payload: { p_id: 'private-row-id' } });
            expect(warn).toHaveBeenCalledOnce();
            const log = JSON.stringify(warn.mock.calls);
            expect(log).not.toContain(op.opId); expect(log).not.toContain('private-row-id'); expect(log).not.toContain('private-rpc-detail');
            expect(warn.mock.calls[0][1]).toMatchObject({ event: 'outbox_permanent_failure', redacted: true });
        } finally { await notifyLogout(); unregister(); warn.mockRestore(); }
    });

});
