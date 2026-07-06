import { describe, expect, it, vi } from 'vitest';
import { createSyncOutbox, type OutboxOp, type OutboxSendResult } from './syncOutbox.ts';
import { cloudOutboxKey } from './cloudPull.ts';

function createMemoryStorage() {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value); },
        removeItem: (key: string) => { map.delete(key); },
    };
}

function makeOutbox(overrides: {
    send?: (op: OutboxOp) => Promise<OutboxSendResult>;
    storage?: ReturnType<typeof createMemoryStorage>;
    storageKey?: string;
    onPermanentFailure?: (op: OutboxOp) => void;
} = {}) {
    const storage = overrides.storage ?? createMemoryStorage();
    const sent: OutboxOp[] = [];
    const send = overrides.send ?? (async (op: OutboxOp) => {
        sent.push(op);
        return { ok: true } as const;
    });
    const outbox = createSyncOutbox({
        storage,
        storageKey: overrides.storageKey ?? cloudOutboxKey('user-a'),
        send,
        onPermanentFailure: overrides.onPermanentFailure,
    });
    return { outbox, storage, sent };
}

describe('createSyncOutbox', () => {
    it('FIFOで送信し、成功したopはキューから消える', async () => {
        const { outbox, sent } = makeOutbox();
        await outbox.load();
        await outbox.enqueue({ operation: 'upsert_task', payload: { p_id: 't1' } });
        await outbox.enqueue({ operation: 'upsert_task', payload: { p_id: 't2' } });
        await outbox.flush();

        expect(sent.map((op) => op.payload.p_id)).toEqual(['t1', 't2']);
        expect(outbox.snapshot()).toHaveLength(0);
    });

    it('dependsOn: 親タスク作成→サブタスク追加の順序が保証される', async () => {
        const order: string[] = [];
        const { outbox } = makeOutbox({
            send: async (op) => { order.push(op.operation); return { ok: true }; },
        });
        await outbox.load();
        const parent = await outbox.enqueue({ operation: 'upsert_task', payload: {} });
        await outbox.enqueue({
            operation: 'upsert_subtask',
            payload: {},
            dependsOn: [parent!.opId],
        });
        await outbox.flush();
        expect(order).toEqual(['upsert_task', 'upsert_subtask']);
    });

    it('同一opIdの二重enqueueは無視される', async () => {
        const { outbox, sent } = makeOutbox();
        await outbox.load();
        await outbox.enqueue({ operation: 'complete_task', payload: {}, opId: 'op-1' });
        const second = await outbox.enqueue({ operation: 'complete_task', payload: {}, opId: 'op-1' });
        expect(second).toBeNull();
        await outbox.flush();
        expect(sent).toHaveLength(1);
    });

    it('一時エラーではpendingへ戻して中断し、次のdrainで再送する', async () => {
        let failOnce = true;
        const sent: string[] = [];
        const { outbox } = makeOutbox({
            send: async (op) => {
                if (failOnce) {
                    failOnce = false;
                    return { ok: false, permanent: false, error: 'network' };
                }
                sent.push(op.opId);
                return { ok: true };
            },
        });
        await outbox.load();
        await outbox.enqueue({ operation: 'upsert_task', payload: {}, opId: 'op-1' });
        await outbox.flush();
        expect(outbox.snapshot()[0]).toMatchObject({ opId: 'op-1', status: 'pending' }); // 失われない

        outbox.requestDrain(); // 再接続相当
        await outbox.flush();
        expect(sent).toEqual(['op-1']);
        expect(outbox.snapshot()).toHaveLength(0);
    });

    it('恒久エラーはfailedになり、依存する後続opへ連鎖し、ロールバックが呼ばれる', async () => {
        const rolledBack: string[] = [];
        const { outbox } = makeOutbox({
            send: async (op) => op.opId === 'root'
                ? { ok: false, permanent: true, error: 'not_found_or_forbidden' }
                : { ok: true },
            onPermanentFailure: (op) => { rolledBack.push(op.opId); },
        });
        await outbox.load();
        await outbox.enqueue({ operation: 'upsert_task', payload: {}, opId: 'root' });
        await outbox.enqueue({ operation: 'upsert_subtask', payload: {}, opId: 'child', dependsOn: ['root'] });
        await outbox.enqueue({ operation: 'upsert_task', payload: {}, opId: 'independent' });
        await outbox.flush();

        const statuses = Object.fromEntries(outbox.snapshot().map((op) => [op.opId, op.status]));
        expect(statuses.root).toBe('failed');
        expect(statuses.child).toBe('failed');   // 連鎖
        expect(statuses.independent).toBeUndefined(); // 独立opは送信済みで消えている
        expect(rolledBack).toEqual(['root', 'child']);
    });

    it('永続化から復元し、前回セッションのinflightはpendingへ戻る（強制終了相当）', async () => {
        const storage = createMemoryStorage();
        storage.map.set(cloudOutboxKey('user-a'), JSON.stringify({
            ops: [{
                opId: 'op-1', operation: 'upsert_task', payload: { p_id: 't1' },
                dependsOn: [], baseVersion: null, status: 'inflight',
                enqueuedAt: '2026-07-06T00:00:00Z', optimisticSnapshot: null,
            }],
        }));
        const { outbox, sent } = makeOutbox({ storage });
        await outbox.load();
        expect(outbox.snapshot()[0].status).toBe('pending');
        outbox.requestDrain();
        await outbox.flush();
        expect(sent.map((op) => op.opId)).toEqual(['op-1']);
    });

    it('stop（ログアウト）: 進行中opはpendingへ戻り、以後drainは走らない', async () => {
        let resolveSend: ((result: OutboxSendResult) => void) | undefined;
        const gate = new Promise<OutboxSendResult>((resolve) => { resolveSend = resolve; });
        const send = vi.fn(async () => gate);
        const storage = createMemoryStorage();
        const { outbox } = makeOutbox({ storage, send });
        await outbox.load();
        await outbox.enqueue({ operation: 'upsert_task', payload: {}, opId: 'op-1' });

        const stopPromise = outbox.stop(); // 送信中に中断
        resolveSend?.({ ok: true });       // 送信自体は成功して返るが…
        await stopPromise;

        // 中断後は結果を反映せずpendingへ戻す（次回ログインで冪等キーにより安全に再送）
        expect(outbox.snapshot()[0]).toMatchObject({ opId: 'op-1', status: 'pending' });
        const persisted = JSON.parse(storage.map.get(cloudOutboxKey('user-a'))!) as { ops: OutboxOp[] };
        expect(persisted.ops[0].status).toBe('pending');

        outbox.requestDrain(); // stop後の要求は無視される
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('namespace分離: ユーザーAのopはBのoutboxロードに現れない（ADR-009）', async () => {
        const storage = createMemoryStorage();
        const a = makeOutbox({ storage, storageKey: cloudOutboxKey('user-a'), send: async () => ({ ok: false, permanent: false, error: 'offline' }) });
        await a.outbox.load();
        await a.outbox.enqueue({ operation: 'upsert_task', payload: { p_id: 'a-task' }, opId: 'a-op' });
        await a.outbox.flush();
        await a.outbox.stop();

        const bSent: OutboxOp[] = [];
        const b = makeOutbox({
            storage,
            storageKey: cloudOutboxKey('user-b'),
            send: async (op) => { bSent.push(op); return { ok: true }; },
        });
        await b.outbox.load();
        expect(b.outbox.snapshot()).toHaveLength(0); // Aのopが混入しない
        b.outbox.requestDrain();
        await b.outbox.flush();
        expect(bSent).toHaveLength(0); // Bのセッション下でAのopが送信されない

        // Aが再ログインすれば再開できる
        const aAgain = makeOutbox({ storage, storageKey: cloudOutboxKey('user-a') });
        await aAgain.outbox.load();
        expect(aAgain.outbox.snapshot().map((op) => op.opId)).toEqual(['a-op']);
    });
});
