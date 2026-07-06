// @vitest-environment node
/**
 * #505 オフラインキューの統合テスト。実行条件はspike.test.tsと同じ
 * （Edge Function検証を含むため SUPABASE_FUNCTIONS_URL も必須）。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cloudOutboxKey } from '@life-quest/core/cloudPull';
import { createSyncOutbox, type OutboxOp, type OutboxSendResult } from '@life-quest/core/syncOutbox';

const DB_URL = process.env.SUPABASE_DB_URL;
const API_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;
const enabled = Boolean(DB_URL && API_URL && ANON_KEY && SERVICE_KEY && FUNCTIONS_URL);

const uuid = () => crypto.randomUUID();

function createMemoryStorage() {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value); },
        removeItem: (key: string) => { map.delete(key); },
    };
}

async function createUser(email: string) {
    const admin = createClient(API_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.createUser({
        email, password: 'password-123', email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const client = createClient(API_URL!, ANON_KEY!, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email, password: 'password-123' });
    const { data: session } = await client.auth.getSession();
    return { id: data.user.id, client, token: session.session!.access_token };
}

/** Mobileブリッジの sendOperation と同じ規約の送信実装（node版） */
function makeSender(user: { client: SupabaseClient; token: string }, isOffline: () => boolean) {
    return async (op: OutboxOp): Promise<OutboxSendResult> => {
        if (isOffline()) return { ok: false, permanent: false, error: 'offline' };
        if (op.operation === 'complete_task') {
            const response = await fetch(`${FUNCTIONS_URL}/complete_task`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...op.payload, idempotencyKey: op.opId }),
            });
            if (response.ok) return { ok: true };
            return { ok: false, permanent: response.status >= 400 && response.status < 500, error: `http_${response.status}` };
        }
        const { error } = await user.client.rpc(op.operation, { ...op.payload, p_key: op.opId });
        if (!error) return { ok: true };
        return { ok: false, permanent: true, error: error.message };
    };
}

describe.skipIf(!enabled)('#505 オフラインキュー（ローカルSupabase統合）', () => {
    let user: Awaited<ReturnType<typeof createUser>>;
    let pg: PgClient;

    beforeAll(async () => {
        pg = new PgClient({ connectionString: DB_URL });
        await pg.connect();
        user = await createUser(`outbox-${Date.now()}@example.com`);
    }, 30000);

    it('機内モード相当: タスク作成→サブタスク追加を積み、復帰後に正しい順序で反映される', async () => {
        let offline = true;
        const storage = createMemoryStorage();
        const outbox = createSyncOutbox({
            storage,
            storageKey: cloudOutboxKey(user.id),
            send: makeSender(user, () => offline),
        });
        await outbox.load();

        const taskId = uuid();
        const subtaskId = uuid();
        const parentOp = await outbox.enqueue({
            operation: 'upsert_task',
            payload: {
                p_id: taskId,
                p_name: 'オフライン作成',
                p_due_date: '2026-07-10',
                p_priority: 'high',
                p_recurrence: 'weekly',
                p_tags: ['家事', '重要'],
            },
        });
        await outbox.enqueue({
            operation: 'upsert_subtask',
            payload: { p_id: subtaskId, p_task_id: taskId, p_name: 'オフライン子' },
            dependsOn: [parentOp!.opId],
        });
        await outbox.flush();

        // オフライン中は何も届かず、キューに残る
        const { rows: before } = await pg.query('select count(*) from tasks where id=$1', [taskId]);
        expect(before[0].count).toBe('0');
        expect(outbox.snapshot()).toHaveLength(2);

        // 復帰 → 親→子の順で反映される
        offline = false;
        outbox.requestDrain();
        await outbox.flush();
        expect(outbox.snapshot()).toHaveLength(0);
        const { rows: subtask } = await pg.query(
            'select task_id from subtasks where id=$1 and user_id=$2', [subtaskId, user.id]);
        expect(subtask).toHaveLength(1);
        expect(subtask[0].task_id).toBe(taskId);

        // Web仕様と同じ情報量が失われず永続化されている（#525マージブロッカー対応）
        const { rows: taskRow } = await pg.query(
            'select name, due_date::text, priority, recurrence, tags from tasks where id=$1', [taskId]);
        expect(taskRow[0]).toEqual({
            name: 'オフライン作成',
            due_date: '2026-07-10',
            priority: 'high',
            recurrence: 'weekly',
            tags: ['家事', '重要'],
        });
    });

    it('強制終了→復元の二重再送でも報酬は1回分（opId=冪等キー）', async () => {
        const taskId = uuid();
        await user.client.rpc('upsert_task', { p_id: taskId, p_name: '報酬対象', p_key: uuid() });

        const storage = createMemoryStorage();
        const key = cloudOutboxKey(user.id);
        const outbox = createSyncOutbox({ storage, storageKey: key, send: makeSender(user, () => false) });
        await outbox.load();
        await outbox.enqueue({ operation: 'complete_task', payload: { taskId }, opId: `complete-${taskId}` });

        // 送信前のキューを退避（クラッシュ時に残るディスク状態を再現）
        const persistedBeforeSend = storage.map.get(key)!;
        await outbox.flush();

        const xpAfterFirst = await pg.query('select total_xp from characters where user_id=$1', [user.id]);

        // 復元した別プロセス相当のoutboxが同じopを再送する
        const restoredStorage = createMemoryStorage();
        restoredStorage.map.set(key, persistedBeforeSend);
        const restored = createSyncOutbox({ storage: restoredStorage, storageKey: key, send: makeSender(user, () => false) });
        await restored.load();
        expect(restored.snapshot()).toHaveLength(1);
        restored.requestDrain();
        await restored.flush();
        expect(restored.snapshot()).toHaveLength(0); // サーバーはキャッシュ結果を返し成功扱い

        const xpAfterResend = await pg.query('select total_xp from characters where user_id=$1', [user.id]);
        expect(xpAfterResend.rows[0].total_xp).toBe(xpAfterFirst.rows[0].total_xp); // 二重付与なし
        const { rows } = await pg.query(
            "select count(*) from reward_transactions where user_id=$1 and kind='task_complete' and source_id=$2",
            [user.id, taskId],
        );
        expect(rows[0].count).toBe('1');
    });
});
