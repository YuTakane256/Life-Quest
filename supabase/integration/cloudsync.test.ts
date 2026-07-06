// @vitest-environment node
/**
 * #504 クラウド同期v1の統合テスト（プル→user_id別キャッシュ→canonicalスナップショット）。
 * 実行条件はspike.test.tsと同じ。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
    applyPullBatchToCache,
    buildCanonicalGameSnapshot,
    buildCanonicalTaskSnapshot,
    countCloudContentRows,
    createEmptyCloudCache,
    loadCloudCache,
    persistCloudCache,
    type CloudCache,
} from '@life-quest/core/cloudCache';
import { cloudCursorKey, createCloudPullRunner, type PullBatch } from '@life-quest/core/cloudPull';

const API_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(API_URL && ANON_KEY && SERVICE_KEY);

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

async function createUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
    const admin = createClient(API_URL!, SERVICE_KEY!, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.createUser({
        email, password: 'password-123', email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const client = createClient(API_URL!, ANON_KEY!, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email, password: 'password-123' });
    return { id: data.user.id, client };
}

describe.skipIf(!enabled)('#504 クラウド同期v1（ローカルSupabase統合）', () => {
    let user: { id: string; client: SupabaseClient };

    beforeAll(async () => {
        user = await createUser(`cloudsync-${Date.now()}@example.com`);
    }, 30000);

    it('プル→キャッシュ→canonicalスナップショットの全経路でサーバーデータが再現される', async () => {
        const taskId = uuid();
        const { error } = await user.client.rpc('upsert_task', { p_id: taskId, p_name: '同期対象', p_key: uuid() });
        expect(error).toBeNull();

        const storage = createMemoryStorage();
        let cache: CloudCache = createEmptyCloudCache();

        const runner = createCloudPullRunner({
            fetchBatch: async (after, max) => {
                const { data, error: pullError } = await user.client.rpc('pull_sync_batch', {
                    p_after_version: after, p_max_versions: max,
                });
                if (pullError) throw new Error(pullError.message);
                return data as PullBatch;
            },
            applyBatch: async (batch) => {
                cache = applyPullBatchToCache(cache, batch);
                await persistCloudCache(storage, user.id, cache);
            },
            readCursor: async () => Number((await storage.getItem(cloudCursorKey(user.id))) ?? 0),
            writeCursor: async (cursor) => { await storage.setItem(cloudCursorKey(user.id), String(cursor)); },
        });
        await runner.flush();

        const tasks = buildCanonicalTaskSnapshot(cache);
        expect(tasks.tasks.map((task) => task.id)).toContain(taskId);

        const game = buildCanonicalGameSnapshot(cache);
        expect(game).not.toBeNull(); // handle_new_userのcharacters行がプルされている
        expect(game!.character.totalXp).toBe(0);

        // カーソルが前進し、再プルは空バッチで冪等
        const cursorAfter = Number(await storage.getItem(cloudCursorKey(user.id)));
        expect(cursorAfter).toBeGreaterThan(0);
        await runner.flush();
        expect(Number(await storage.getItem(cloudCursorKey(user.id)))).toBe(cursorAfter);

        // 永続化キャッシュからの復元（オフライン表示経路）
        const restored = await loadCloudCache(storage, user.id);
        expect(buildCanonicalTaskSnapshot(restored).tasks.map((task) => task.id)).toContain(taskId);

        // namespace分離: 別ユーザーIDでのロードは空
        const otherView = await loadCloudCache(storage, 'other-user');
        expect(countCloudContentRows(otherView)).toBe(0);
    });
});
