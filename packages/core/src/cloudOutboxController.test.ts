import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from './authLifecycle.ts';
import {
    createCloudOutboxController,
    EDGE_OPERATIONS,
    RPC_OPERATIONS,
    type CloudOutboxControllerDeps,
    type CloudOutboxRpcClient,
} from './cloudOutboxController.ts';
import { EdgeFunctionError, type EdgeFunctionInvoker } from './edgeFunctions.ts';
import type { OutboxOp } from './syncOutbox.ts';

function createMemoryStorage() {
    const map = new Map<string, string>();
    return {
        getItem: async (key: string) => map.get(key) ?? null,
        setItem: async (key: string, value: string) => { map.set(key, value); },
        removeItem: async (key: string) => { map.delete(key); },
    };
}

function makeOp(operation: string, payload: Record<string, unknown> = {}): OutboxOp {
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

describe('sendOperation', () => {
    it('RPC_OPERATIONSはrpcクライアント経由で送られ、opIdがp_keyになる', async () => {
        const rpcCalls: { name: string; params: Record<string, unknown> }[] = [];
        const rpcClient: CloudOutboxRpcClient = {
            rpc: async (name, params) => {
                rpcCalls.push({ name, params });
                return { error: null };
            },
        };
        const controller = createCloudOutboxController({
            storage: createMemoryStorage(),
            getRpcClient: () => rpcClient,
            getEdgeInvoker: () => null,
        });

        const result = await controller.sendOperation(makeOp('delete_subtask', { p_id: 'sub-1' }));
        expect(result).toEqual({ ok: true });
        expect(rpcCalls).toEqual([{ name: 'delete_subtask', params: { p_id: 'sub-1', p_key: 'op-1' } }]);
    });

    it('RPCエラーはcode有無で一時/恒久を判定する', async () => {
        const controller = createCloudOutboxController({
            storage: createMemoryStorage(),
            getRpcClient: () => ({
                rpc: async () => ({ error: { message: 'invalid', code: '23505' } }),
            }),
            getEdgeInvoker: () => null,
        });
        const result = await controller.sendOperation(makeOp('upsert_task', {}));
        expect(result).toEqual({ ok: false, permanent: true, error: 'invalid' });
    });

    it('rpcクライアント未取得（未ログイン等）は一時エラー', async () => {
        const controller = createCloudOutboxController({
            storage: createMemoryStorage(),
            getRpcClient: () => null,
            getEdgeInvoker: () => null,
        });
        const result = await controller.sendOperation(makeOp('upsert_task', {}));
        expect(result).toEqual({ ok: false, permanent: false, error: 'supabase env not configured' });
    });

    it('EDGE_OPERATIONSはinvoker経由で送られ、opIdがidempotencyKeyになる', async () => {
        const calls: { name: string; body: Record<string, unknown> }[] = [];
        const invoker: EdgeFunctionInvoker = async <TResult>(name: string, body: Record<string, unknown> = {}) => {
            calls.push({ name, body });
            return {} as TResult;
        };
        const controller = createCloudOutboxController({
            storage: createMemoryStorage(),
            getRpcClient: () => null,
            getEdgeInvoker: () => invoker,
        });

        const result = await controller.sendOperation(makeOp('complete_task', { taskId: 't1' }));
        expect(result).toEqual({ ok: true });
        expect(calls).toEqual([{ name: 'complete_task', body: { taskId: 't1', idempotencyKey: 'op-1' } }]);
    });

    it('EdgeFunctionErrorのstatusで一時/恒久を判定する', async () => {
        const controller = createCloudOutboxController({
            storage: createMemoryStorage(),
            getRpcClient: () => null,
            getEdgeInvoker: () => async () => {
                throw new EdgeFunctionError('http-error', 'not found', 404);
            },
        });
        const result = await controller.sendOperation(makeOp('complete_task', {}));
        expect(result).toEqual({ ok: false, permanent: true, error: 'not found' });
    });

    it('未知の操作は恒久失敗として報告される', async () => {
        const controller = createCloudOutboxController({
            storage: createMemoryStorage(),
            getRpcClient: () => null,
            getEdgeInvoker: () => null,
        });
        const result = await controller.sendOperation(makeOp('bogus_operation', {}));
        expect(result).toEqual({ ok: false, permanent: true, error: 'unknown operation: bogus_operation' });
    });

    it('RPC_OPERATIONS/EDGE_OPERATIONSに既知の操作が網羅されている', () => {
        const knownOperations = [
            'upsert_task', 'delete_task', 'uncomplete_task',
            'upsert_subtask', 'delete_subtask', 'uncomplete_subtask',
            'complete_task', 'complete_subtask',
            'upsert_habit', 'delete_habit', 'set_rest_day', 'set_habit_log', 'claim_habit_bonus',
            'sell_item', 'upsert_profile', 'update_character_profile', 'set_equipped_items',
        ];
        for (const operation of knownOperations) {
            expect(
                RPC_OPERATIONS.has(operation) || EDGE_OPERATIONS.has(operation),
                `${operation} has no send route`,
            ).toBe(true);
        }
    });

    it('非決定論的なゲーム操作（request/response専用）はEDGE_OPERATIONS/RPC_OPERATIONSに含まれない', async () => {
        // open_chest等をこのoutbox経由でenqueueしても専用エラー分岐（409→discard等）
        // を迂回できないことを保証する回帰テスト（誤って積める状態に戻すと壊れる）。
        const requestResponseOnlyOperations = [
            'open_chest', 'synthesize_items', 'start_battle_attempt', 'resolve_battle_attempt',
        ];
        for (const operation of requestResponseOnlyOperations) {
            expect(RPC_OPERATIONS.has(operation), `${operation} should not be in RPC_OPERATIONS`).toBe(false);
            expect(EDGE_OPERATIONS.has(operation), `${operation} should not be in EDGE_OPERATIONS`).toBe(false);
        }

        const controller = createCloudOutboxController({
            storage: createMemoryStorage(),
            getRpcClient: () => null,
            getEdgeInvoker: () => null,
        });
        for (const operation of requestResponseOnlyOperations) {
            const result = await controller.sendOperation(makeOp(operation, {}));
            expect(result).toEqual({ ok: false, permanent: true, error: `unknown operation: ${operation}` });
        }
    });
});

describe('enqueue', () => {
    const baseDeps: CloudOutboxControllerDeps = {
        storage: createMemoryStorage(),
        getRpcClient: () => ({ rpc: async () => ({ error: null }) }),
        getEdgeInvoker: () => null,
    };

    it('outbox非アクティブ（未ログイン）ならfalse', async () => {
        const controller = createCloudOutboxController(baseDeps);
        expect(await controller.enqueue('upsert_task', { p_id: 't1' })).toBe(false);
    });

    it('trackEntityId/dependsOnEntityIdsでエンティティ単位の依存を張る', async () => {
        // 送信自体は失敗させ続けてキューに残す（依存関係の観測のため）
        const controller = createCloudOutboxController({
            storage: createMemoryStorage(),
            getRpcClient: () => null,
            getEdgeInvoker: () => null,
        });
        const unregister = controller.registerHooks();
        await notifyLogin('user-a');
        await vi.waitFor(() => expect(controller.isActive()).toBe(true));

        await controller.enqueue('upsert_task', { p_id: 't1' }, { trackEntityId: 't1' });
        await controller.enqueue('complete_task', { taskId: 't1' }, { dependsOnEntityIds: ['t1'] });

        const ops = controller.getActiveOutbox()?.snapshot() ?? [];
        expect(ops).toHaveLength(2);
        expect(ops[1].dependsOn).toEqual([ops[0].opId]);

        unregister();
    });
});

describe('registerHooks（認証ライフサイクル配線）', () => {
    afterEach(() => {
        resetAuthLifecycleHooks();
    });

    it('ログインでoutboxが起動し、isActiveがtrueになる', async () => {
        const controller = createCloudOutboxController({
            storage: createMemoryStorage(),
            getRpcClient: () => null,
            getEdgeInvoker: () => null,
        });
        const unregister = controller.registerHooks();

        expect(controller.isActive()).toBe(false);
        await notifyLogin('user-a');
        await vi.waitFor(() => expect(controller.isActive()).toBe(true));

        unregister();
    });

    it('ログアウトでoutboxが停止し、isActiveがfalseになる', async () => {
        const controller = createCloudOutboxController({
            storage: createMemoryStorage(),
            getRpcClient: () => null,
            getEdgeInvoker: () => null,
        });
        const unregister = controller.registerHooks();

        await notifyLogin('user-a');
        await vi.waitFor(() => expect(controller.isActive()).toBe(true));
        await notifyLogout();
        expect(controller.isActive()).toBe(false);

        unregister();
    });

    it('unregister後はログイン通知に反応しない', async () => {
        const controller = createCloudOutboxController({
            storage: createMemoryStorage(),
            getRpcClient: () => null,
            getEdgeInvoker: () => null,
        });
        const unregister = controller.registerHooks();
        unregister();

        await notifyLogin('user-a');
        expect(controller.isActive()).toBe(false);
    });
});
