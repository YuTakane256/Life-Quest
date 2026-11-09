// @vitest-environment jsdom
/** Real local DB/Edge → pull/cache → production Web/Mobile stores.
 * Only Native disk and delivery timing/loss are simulated; no staging or device UI.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client as PgClient } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { captureAuthSessionScope, notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import type { PullBatch } from '@life-quest/core/cloudPull';
import { createEdgeFunctionInvoker, type EdgeFunctionInvoker } from '@life-quest/core/edgeFunctions';
import { createGameCloudClient, type CloudSynthesisResult, type GameCloudClient } from '@life-quest/core/gameCloud';
import { createSynthesisRecovery, synthesisRecoveryKey } from '@life-quest/core/synthesisRecovery';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { EQUIPMENT_POOL, SELL_XP_BY_RARITY } from '@life-quest/core/rewards';
import { assertLocalSyncEnvironment, syncEnvironmentKeys } from '../../scripts/run-sync-quality.mjs';
import { applyCloudCacheToWebStores } from '../../src/platform/cloudSync';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from '../../src/platform/completionRewards';
import { useGameStore } from '../../src/stores/useGameStore';
import { applyCloudCacheToMobileStores } from '../../apps/mobile/src/platform/cloudSeed';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';

const { nativeDisk, nativeStorage } = vi.hoisted(() => {
    const nativeDisk = new Map<string, string>();
    return { nativeDisk, nativeStorage: {
        getItem: async (key: string) => nativeDisk.get(key) ?? null,
        setItem: async (key: string, value: string) => { nativeDisk.set(key, value); },
        removeItem: async (key: string) => { nativeDisk.delete(key); },
    } };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: nativeStorage }));
const env = process.env;
const enabled = syncEnvironmentKeys.every((key) => Boolean(env[key]));
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const initialWeb = useGameStore.getInitialState();
const initialXp = 200;
type Platform = 'Web' | 'Mobile';
type Delivery = '応答が先' | '同期が先' | '応答喪失後に売却' | '次の合成後に旧応答';
const cases = (['Web', 'Mobile'] as const).flatMap((platform) =>
    (['応答が先', '同期が先', '応答喪失後に売却', '次の合成後に旧応答'] as const).map((delivery) => ({ platform, delivery })));

describe.skipIf(!enabled)('装備合成の実送信・受信・古い結果再送（ローカルDB/Edge）', () => {
    let pg: PgClient;
    let admin: SupabaseClient;
    let client: SupabaseClient | undefined;
    let createdUserId: string | null = null;
    let game: GameCloudClient;
    let edge: EdgeFunctionInvoker;
    let ingredients: string[];
    let nextIngredients: string[];
    let keptId: string;
    let loseResponse = false;
    let lostResponses = 0;
    beforeAll(async () => {
        // Reject non-loopback destinations before any connection or disposable user creation.
        assertLocalSyncEnvironment(env);
        admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
            auth: { ...authOptions, storageKey: `synthesis-admin-${crypto.randomUUID()}` },
        });
        pg = new PgClient({ connectionString: env.SUPABASE_DB_URL }); await pg.connect();
    }, 30000);
    beforeEach(async () => {
        await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); localStorage.clear(); nativeDisk.clear();
        createdUserId = null; client = undefined; loseResponse = false; lostResponses = 0;
        withoutCompletionRewardPersistence(() => useGameStore.setState(initialWeb));
        useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), activeBattle: null, hasHydrated: true, pendingChestReveal: null, lastLevelUp: null });
        setGameRewardAuthorityState('authenticated');
        const email = `synthesis-seed-${crypto.randomUUID()}@example.com`;
        const password = 'local-test-password-123';
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error || !created.data.user) throw new Error('Disposable synthesis account creation failed');
        createdUserId = created.data.user.id;
        client = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
            auth: { ...authOptions, storageKey: `synthesis-user-${createdUserId}` },
        });
        const signedIn = await client.auth.signInWithPassword({ email, password });
        if (signedIn.error || !signedIn.data.session) throw new Error('Disposable synthesis account sign in failed');
        const session = signedIn.data.session;
        const transport: typeof fetch = async (input, init) => {
            const response = await fetch(input, init);
            const url = input instanceof Request ? input.url : String(input);
            if (loseResponse && response.ok && url.endsWith('/functions/v1/synthesize_items')) {
                loseResponse = false; lostResponses += 1;
                await response.arrayBuffer(); // Server committed; only the successful response delivery is lost.
                throw new TypeError('Simulated synthesis response loss after commit');
            }
            return response;
        };
        edge = createEdgeFunctionInvoker({ functionsUrl: env.SUPABASE_FUNCTIONS_URL!, anonKey: env.SUPABASE_ANON_KEY!,
            getSession: async () => ({ accessToken: session.access_token, userId: session.user.id }),
            refreshSession: async () => null, fetchFn: transport });
        game = createGameCloudClient({ getInvoker: () => edge });
        await notifyLogin(createdUserId);
        ingredients = Array.from({ length: 3 }, () => crypto.randomUUID());
        nextIngredients = Array.from({ length: 2 }, () => crypto.randomUUID()); keptId = crypto.randomUUID();
        // Fixture only, owned by this test: three common materials, two uncommon materials for the next synthesis, one unrelated item.
        await pg.query('begin');
        try {
            await pg.query('select public.lock_user_sync($1)', [createdUserId]);
            const version = await pg.query('select public.next_sync_version($1) as v', [createdUserId]);
            const updated = await pg.query('update public.characters set total_xp=$2, version=$3 where user_id=$1', [createdUserId, initialXp, version.rows[0].v]);
            expect(updated.rowCount).toBe(1);
            for (const [id, template] of [
                ...ingredients.map((id) => [id, 'wooden_sword']),
                ...nextIngredients.map((id) => [id, 'iron_sword']), [keptId, 'wooden_ring'],
            ]) {
                await pg.query('insert into public.inventory_items (id,user_id,template_id,version) values ($1,$2,$3,$4)',
                    [id, createdUserId, template, version.rows[0].v]);
            }
            await pg.query('commit');
        } catch (error) { await pg.query('rollback'); throw error; }
    }, 30000);
    afterEach(async () => {
        client?.auth.stopAutoRefresh(); await flushCompletionRewardWrites();
        resetAuthLifecycleHooks(); setGameRewardAuthorityState('anonymous'); localStorage.clear();
        // Only this test's disposable account. No reset/truncate or staging/user-data cleanup.
        if (createdUserId) {
            const { error } = await admin.auth.admin.deleteUser(createdUserId);
            if (error) throw new Error('Disposable synthesis account cleanup failed');
        }
    });
    afterAll(async () => { await pg?.end(); });

    const requestOptions = () => ({ expectedUserId: createdUserId!, isActive: () => true });
    async function pull() {
        let cache = createEmptyCloudCache(); let cursor = 0;
        for (let page = 0; page < 50; page += 1) {
            const { data, error } = await client!.rpc('pull_sync_batch', { p_after_version: cursor, p_max_versions: 100 });
            if (error) throw new Error('Synthesis fixture pull failed');
            const batch = data as PullBatch; cache = applyPullBatchToCache(cache, batch);
            if (!batch.has_more) return cache;
            expect(batch.next_cursor).toBeGreaterThan(cursor); cursor = batch.next_cursor;
        }
        throw new Error('Synthesis fixture pull exceeded page limit');
    }
    function seed(platform: Platform, cache: Awaited<ReturnType<typeof pull>>) {
        expect(platform === 'Web' ? applyCloudCacheToWebStores(cache) : applyCloudCacheToMobileStores(cache)).toBe(true);
    }
    function store(platform: Platform) { return platform === 'Web' ? useGameStore.getState() : useMobileGameStore.getState(); }
    function deliver(platform: Platform, ids: string[], result: CloudSynthesisResult) {
        return store(platform).applyCloudSynthesisResult(ids, result.resultId, result.templateId);
    }
    async function assertCanonical(platform: Platform, xp: number) {
        // This is a comparison only; do not seed here and hide a transient resurrection.
        const actual = await pg.query('select id,template_id,equipped from public.inventory_items where user_id=$1 and deleted_at is null order by id', [createdUserId]);
        expect(store(platform).equipment.map((item) => ({ id: item.id, template_id: item.templateId, equipped: item.equipped }))
            .sort((a, b) => a.id.localeCompare(b.id))).toEqual(actual.rows);
        expect(store(platform).equipment.some((item) => item.id === keptId)).toBe(true);
        expect(store(platform).character.totalXp).toBe(xp);
        const character = await pg.query('select total_xp from public.characters where user_id=$1', [createdUserId]);
        expect(Number(character.rows[0].total_xp)).toBe(xp);
    }

    it.each(cases)('$platform：$delivery / 同じ結果と素材消費を保ち、削除済み装備を復活させない', async ({ platform, delivery }: { platform: Platform; delivery: Delivery }) => {
        seed(platform, await pull()); expect(store(platform).equipment).toHaveLength(6);
        const key = crypto.randomUUID();
        const synthesize = () => game.synthesizeItems(ingredients, key, requestOptions());
        let original: CloudSynthesisResult | null = null;
        if (delivery === '応答喪失後に売却') {
            loseResponse = true; await expect(synthesize()).rejects.toThrow(); expect(lostResponses).toBe(1);
        } else {
            original = await synthesize(); expect(original).not.toBeNull();
        }
        // Inspect the actual SQL receipt, including for the lost-response case. This does not deliver it to either store.
        const receipt = await pg.query('select result from public.idempotency_keys where user_id=$1 and key=$2 and operation=$3', [createdUserId, key, 'synthesize_items']);
        expect(receipt.rows).toHaveLength(1);
        const recorded = receipt.rows[0].result as { result_id: string; template_id: string; version: number };
        expect(recorded.result_id).toBeTruthy(); expect(recorded.template_id).toBeTruthy();
        expect(Number.isSafeInteger(recorded.version) && recorded.version > 0).toBe(true);
        const first = { resultId: recorded.result_id, templateId: recorded.template_id };
        if (original) expect(original).toEqual(first);
        const sources = await pg.query('select deleted_at,version from public.inventory_items where user_id=$1 and id=any($2::uuid[])', [createdUserId, ingredients]);
        expect(sources.rows).toHaveLength(3);
        expect(sources.rows.every((row) => row.deleted_at !== null && Number(row.version) === recorded.version)).toBe(true);
        const product = await pg.query('select template_id,version from public.inventory_items where user_id=$1 and id=$2 and deleted_at is null', [createdUserId, first.resultId]);
        expect(product.rows).toHaveLength(1); expect(product.rows[0].template_id).toBe(first.templateId);
        expect(Number(product.rows[0].version)).toBe(recorded.version);
        let expectedXp = initialXp;
        if (delivery === '応答が先') {
            expect(deliver(platform, ingredients, original!)?.id).toBe(first.resultId);
            await assertCanonical(platform, expectedXp);
        }
        if (delivery === '同期が先') {
            const equipped = await client!.rpc('set_equipped_items', { p_item_ids: [first.resultId], p_key: crypto.randomUUID() });
            expect(equipped.error).toBeNull();
        }
        seed(platform, await pull()); await assertCanonical(platform, expectedXp);
        if (delivery === '応答喪失後に売却') {
            const template = EQUIPMENT_POOL.find((candidate) => candidate.id === first.templateId)!; expect(template).toBeTruthy();
            const sale = await edge<{ granted: boolean; xp: number }>('sell_item', { itemId: first.resultId, idempotencyKey: crypto.randomUUID() }, requestOptions());
            expect(sale.granted).toBe(true); expect(sale.xp).toBe(SELL_XP_BY_RARITY[template.rarity]);
            expectedXp += sale.xp; seed(platform, await pull());
        } else if (delivery === '次の合成後に旧応答') {
            const nextIds = [first.resultId, ...nextIngredients];
            const next = await game.synthesizeItems(nextIds, crypto.randomUUID(), requestOptions());
            expect(next).not.toBeNull(); expect(next!.resultId).not.toBe(first.resultId);
            seed(platform, await pull()); expect(store(platform).equipment.some((item) => item.id === next!.resultId)).toBe(true);
        }
        const removed = delivery === '応答喪失後に売却' || delivery === '次の合成後に旧応答';
        await assertCanonical(platform, expectedXp);
        if (original) {
            const applied = deliver(platform, ingredients, original);
            if (removed) expect(applied).toBeNull(); else expect(applied?.id).toBe(first.resultId);
            await assertCanonical(platform, expectedXp);
        }
        for (let replay = 0; replay < 2; replay += 1) {
            const repeated = await synthesize(); expect(repeated).toEqual(first);
            const applied = deliver(platform, ingredients, repeated!);
            if (removed) expect(applied).toBeNull(); else expect(applied?.id).toBe(first.resultId);
            if (delivery === '同期が先') expect(applied?.equipped).toBe(true);
            await assertCanonical(platform, expectedXp); // No later pull can repair a false positive before this assertion.
        }
        const receipts = await pg.query("select count(*) as count from public.idempotency_keys where user_id=$1 and operation='synthesize_items'", [createdUserId]);
        expect(Number(receipts.rows[0].count)).toBe(delivery === '次の合成後に旧応答' ? 2 : 1);
        const sales = await pg.query("select count(*) as count, coalesce(sum(xp_delta),0) as xp from public.reward_transactions where user_id=$1 and kind='sell_item'", [createdUserId]);
        expect(Number(sales.rows[0].count)).toBe(delivery === '応答喪失後に売却' ? 1 : 0);
        expect(Number(sales.rows[0].xp)).toBe(expectedXp - initialXp);
        if (removed) {
            const tombstone = await pg.query('select deleted_at,version from public.inventory_items where user_id=$1 and id=$2', [createdUserId, first.resultId]);
            expect(tombstone.rows[0].deleted_at).not.toBeNull(); expect(Number(tombstone.rows[0].version)).toBeGreaterThan(recorded.version);
        }
        seed(platform, await pull()); seed(platform, await pull()); await assertCanonical(platform, expectedXp);
    }, 30000);
    const restartCases = (['Web', 'Mobile'] as const).flatMap((platform) =>
        [false, true].map((alreadyCommitted) => ({ platform, alreadyCommitted })));
    it.each(restartCases)('$platform / 再起動後の合成再送（確定して売却済み: $alreadyCommitted）', async ({ platform, alreadyCommitted }) => {
        seed(platform, await pull());
        const owner = createdUserId!;
        const disk = platform === 'Web' ? localStorage : nativeStorage;
        const initialJournal = createSynthesisRecovery({ storage: disk });
        const { record } = await initialJournal.prepare(owner, ingredients, () => crypto.randomUUID());
        let soldId: string | undefined;
        let expectedXp = initialXp;
        if (alreadyCommitted) {
            loseResponse = true;
            await expect(game.synthesizeItems(record.itemIds, record.key, requestOptions())).rejects.toThrow();
            expect(lostResponses).toBe(1);
            const receipt = await pg.query('select result from public.idempotency_keys where user_id=$1 and key=$2', [owner, record.key]);
            soldId = receipt.rows[0].result.result_id;
            const sold = await edge<{ granted: boolean; xp: number }>('sell_item', {
                itemId: soldId, idempotencyKey: crypto.randomUUID(),
            }, requestOptions());
            expect(sold.granted).toBe(true);
            expectedXp += sold.xp;
        }

        await flushCompletionRewardWrites();
        const gameKey = 'quest-board-game';
        const rawGame = await disk.getItem(gameKey);
        expect(rawGame).toBeTruthy();
        if (platform === 'Web') {
            withoutCompletionRewardPersistence(() => useGameStore.setState(initialWeb));
            localStorage.setItem(gameKey, rawGame!);
            await useGameStore.persist.rehydrate();
        } else {
            useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: false });
            await nativeStorage.setItem(gameKey, rawGame!);
            await useMobileGameStore.persist.rehydrate();
        }
        const beforeSync = store(platform).equipment.map(({ id }) => id);
        expect(beforeSync).toEqual(expect.arrayContaining(ingredients)); // Stale local inventory must not be used to apply a replay.
        const reopened = createSynthesisRecovery({ storage: disk });
        await reopened.load();
        const pending = reopened.getState().pending!;
        expect(pending).toEqual(record);
        const restored = await reopened.prepare(owner, pending.itemIds, () => 'unexpected-new-key', pending);
        expect(restored.fresh).toBe(false);
        expect(restored.record).toEqual(record);
        const confirmed = await game.synthesizeItems(restored.record.itemIds, restored.record.key, requestOptions());
        expect(confirmed?.resultId).toBeTruthy();
        if (soldId) expect(confirmed?.resultId).toBe(soldId);
        expect(await reopened.acknowledge(restored.record, captureAuthSessionScope())).toBe(true);
        expect(await disk.getItem(synthesisRecoveryKey(owner))).toBeNull();
        expect(store(platform).equipment.map(({ id }) => id)).toEqual(beforeSync);
        seed(platform, await pull());
        await assertCanonical(platform, expectedXp);
        expect(store(platform).equipment.some((item) => item.id === confirmed!.resultId)).toBe(!alreadyCommitted);

        const consumed = await pg.query('select count(*) as count from public.inventory_items where user_id=$1 and id=any($2::uuid[]) and deleted_at is not null', [owner, ingredients]);
        expect(Number(consumed.rows[0].count)).toBe(ingredients.length);
        const receipts = await pg.query("select key from public.idempotency_keys where user_id=$1 and operation='synthesize_items'", [owner]);
        expect(receipts.rows).toEqual([{ key: record.key }]);
    }, 30000);

});
