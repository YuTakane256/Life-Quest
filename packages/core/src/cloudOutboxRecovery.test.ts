import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from './authLifecycle.ts';
import { cloudOutboxKey } from './cloudPull.ts';
import { createCloudOutboxController } from './cloudOutboxController.ts';
import type { OutboxOp } from './syncOutbox.ts';

function storageWith(ops: OutboxOp[], userId = 'a') {
    const data = new Map([[cloudOutboxKey(userId), JSON.stringify({ ops })]]);
    return {
        getItem: async (key: string) => data.get(key) ?? null,
        setItem: async (key: string, value: string) => { data.set(key, value); },
        removeItem: async (key: string) => { data.delete(key); },
    };
}

function savedOp(opId: string, operation: string, payload: Record<string, unknown>,
    rest: Partial<OutboxOp> = {}): OutboxOp {
    return { opId, operation, payload, dependsOn: [], status: 'pending', baseVersion: null,
        enqueuedAt: '2026-10-29T00:00:00Z', optimisticSnapshot: null, ...rest };
}

afterEach(() => resetAuthLifecycleHooks());

describe('restored outbox entity dependencies', () => {
    it('新しいcontrollerでも保存済み親子の操作IDを依存先にし、元の依存配列は書き換えない', async () => {
        const storage = storageWith([]);
        const deps = { storage, getRpcClient: () => null, getEdgeInvoker: () => null };
        const first = createCloudOutboxController(deps);
        const unregisterFirst = first.registerHooks();
        await notifyLogin('a');
        await Promise.all([
            first.enqueue('upsert_task', { p_id: 't1' }, { trackEntityId: 't1' }),
            first.enqueue('upsert_subtask', { p_id: 's1', p_task_id: 't1' }, {
                dependsOnEntityIds: ['t1'], trackEntityId: 's1',
            }),
        ]);
        await first.getActiveOutbox()!.flush();
        const before = first.getActiveOutbox()!.snapshot();
        await notifyLogout();
        unregisterFirst();

        const restored = createCloudOutboxController(deps);
        const unregister = restored.registerHooks();
        await notifyLogin('a');
        await restored.getActiveOutbox()!.flush();
        await restored.enqueue('complete_subtask', { subtaskId: 's1' }, {
            dependsOnEntityIds: ['t1', 's1'],
        });
        await restored.getActiveOutbox()!.flush();
        const after = restored.getActiveOutbox()!.snapshot();
        expect(after.slice(0, 2).map((op) => [op.opId, op.dependsOn, op.payload]))
            .toEqual(before.map((op) => [op.opId, op.dependsOn, op.payload]));
        expect(after[2].dependsOn).toEqual(before.map((op) => op.opId));
        const persisted = JSON.parse((await storage.getItem(cloudOutboxKey('a')))!);
        expect(persisted.ops[2].dependsOn).toEqual(before.map((op) => op.opId));
        unregister();
    });

    it('復元した親が送信中に追加した子も、親の恒久失敗で停止する', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const sent: string[] = [];
        const controller = createCloudOutboxController({
            storage: storageWith([savedOp('parent-op', 'upsert_task', { p_id: 't1' })]),
            getRpcClient: () => ({ rpc: async (_name, params) => {
                sent.push(String(params.p_id));
                if (params.p_id === 't1') {
                    await gate;
                    return { error: { code: '422', message: 'invalid parent' } };
                }
                return { error: null };
            } }),
            getEdgeInvoker: () => null,
        });
        const unregister = controller.registerHooks();
        await notifyLogin('a');
        await vi.waitFor(() => expect(sent).toEqual(['t1']));
        await Promise.all([
            controller.enqueue('upsert_subtask', { p_id: 's1', p_task_id: 't1' }, {
                dependsOnEntityIds: ['t1'], trackEntityId: 's1',
            }),
            controller.enqueue('delete_task', { p_id: 'independent' }),
        ]);
        release();
        await controller.getActiveOutbox()!.flush();
        expect(sent).toEqual(['t1', 'independent']);
        expect(controller.getActiveOutbox()!.snapshot().map((op) => [op.status, op.failure?.kind]))
            .toEqual([['failed', 'validation'], ['failed', 'dependency']]);
        unregister();
    });

    it.each(['failed', 'conflict'] as const)('復元した%sの親への新しい子孫も送らず、失敗状態を保存する', async (status) => {
        const parent = savedOp('parent-op', 'upsert_task', { p_id: 't1' }, {
            status, failure: { kind: status === 'conflict' ? 'conflict' : 'validation', occurredAt: '2026-10-29T00:00:00Z' },
        });
        const storage = storageWith([parent]);
        const rpc = vi.fn(async () => ({ error: null }));
        const rollback = vi.fn<(op: OutboxOp) => void>();
        const controller = createCloudOutboxController({ storage,
            getRpcClient: () => ({ rpc }), getEdgeInvoker: () => null, onPermanentFailure: rollback });
        const unregister = controller.registerHooks();
        await notifyLogin('a');
        await Promise.all([
            controller.enqueue('upsert_subtask', { p_id: 's1', p_task_id: 't1' }, {
                dependsOnEntityIds: ['t1'], trackEntityId: 's1',
            }),
            controller.enqueue('complete_subtask', { subtaskId: 's1' }, { dependsOnEntityIds: ['s1'] }),
        ]);
        await controller.getActiveOutbox()!.flush();
        expect(rpc).not.toHaveBeenCalled();
        const ops = controller.getActiveOutbox()!.snapshot();
        expect(ops[0]).toEqual(parent);
        expect(ops.slice(1).map((op) => [op.status, op.failure?.kind]))
            .toEqual([['failed', 'dependency'], ['failed', 'dependency']]);
        expect(rollback.mock.calls.map(([op]) => op.opId))
            .toEqual(ops.slice(1).map((op) => op.opId));
        const persisted = JSON.parse((await storage.getItem(cloudOutboxKey('a')))!);
        expect(persisted.ops).toEqual(ops);
        unregister();
    });

    it.each([
        ['upsert_task', 'p_id'], ['upsert_subtask', 'p_id'], ['delete_subtask', 'p_id'],
        ['upsert_habit', 'p_id'], ['set_habit_log', 'p_habit_id'],
    ])('%sは保存順で最新の操作を追跡し、無関係な操作の同名フィールドは追跡しない', async (operation, field) => {
        const ops = [
            savedOp('older', operation, { [field]: 'entity' }),
            savedOp('latest', operation, { [field]: 'entity' }),
            savedOp('untracked', 'unknown', { [field]: 'entity' }),
            savedOp('empty', operation, { [field]: '' }),
            savedOp('invalid', operation, { [field]: 42 }),
        ];
        const controller = createCloudOutboxController({ storage: storageWith(ops),
            getRpcClient: () => null, getEdgeInvoker: () => null });
        const unregister = controller.registerHooks();
        await notifyLogin('a');
        await controller.enqueue('delete_task', { p_id: 'entity' }, { dependsOnEntityIds: ['entity'] });
        await controller.getActiveOutbox()!.flush();
        const restored = controller.getActiveOutbox()!.snapshot();
        expect(restored[restored.length - 1].dependsOn).toEqual(['latest']);
        unregister();
    });

    it('遅れたAの復元を捨て、Bの保存キューだけから依存先を復元する', async () => {
        const a = savedOp('a-parent', 'upsert_task', { p_id: 'same-entity' });
        const b = savedOp('b-parent', 'upsert_task', { p_id: 'same-entity' });
        const storage = storageWith([a]);
        await storage.setItem(cloudOutboxKey('b'), JSON.stringify({ ops: [b] }));
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let entered!: () => void;
        const loading = new Promise<void>((resolve) => { entered = resolve; });
        vi.spyOn(storage, 'getItem').mockImplementationOnce(async () => {
            entered();
            await gate;
            return JSON.stringify({ ops: [a] });
        });
        const controller = createCloudOutboxController({ storage,
            getRpcClient: () => null, getEdgeInvoker: () => null });
        const unregister = controller.registerHooks();
        const loginA = notifyLogin('a');
        await loading;
        await notifyLogin('b');
        release();
        await loginA;
        await controller.enqueue('upsert_subtask', { p_id: 's1', p_task_id: 'same-entity' }, {
            dependsOnEntityIds: ['same-entity'],
        });
        await controller.getActiveOutbox()!.flush();
        const ops = controller.getActiveOutbox()!.snapshot();
        expect(ops).toHaveLength(2);
        expect(ops[0].opId).toBe('b-parent');
        expect(ops[1].dependsOn).toEqual(['b-parent']);
        unregister();
    });
});
