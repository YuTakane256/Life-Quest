// @vitest-environment jsdom
/** Local JWT/Edge/SQL → actual pull/cache → Web/Mobile runner and stores.
 * Only Native disk and HTTP response delivery timing/loss are simulated.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client as PgClient } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import type { PullBatch } from '@life-quest/core/cloudPull';
import { createEdgeFunctionInvoker, type EdgeFunctionInvoker } from '@life-quest/core/edgeFunctions';
import { createGameCloudClient, type CloudChestResult, type GameCloudClient } from '@life-quest/core/gameCloud';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { chestOpenRetryKey, EQUIPMENT_POOL, SELL_XP_BY_RARITY } from '@life-quest/core/rewards';
import { assertLocalSyncEnvironment, syncEnvironmentKeys } from '../../scripts/run-sync-quality.mjs';
import { applyCloudCacheToWebStores } from '../../src/platform/cloudSync';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from '../../src/platform/completionRewards';
import { useGameStore } from '../../src/stores/useGameStore';
import { runCloudChestOpen as runWeb } from '../../src/hooks/useCloudChestOpen';
import { applyCloudCacheToMobileStores } from '../../apps/mobile/src/platform/cloudSeed';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';
import { runCloudChestOpen as runMobile } from '../../apps/mobile/src/hooks/useCloudChestOpen';

const nativeDisk = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async (key: string) => nativeDisk.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { nativeDisk.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { nativeDisk.delete(key); }),
} }));
// These are unused hook imports. Both decision runners receive the real local transport below.
vi.mock('../../apps/mobile/src/platform/battleCloud', () => ({ openCloudChest: vi.fn() }));
vi.mock('../../apps/mobile/src/platform/auth', () => ({ getGameAuthState: vi.fn() }));

const env = process.env;
const enabled = syncEnvironmentKeys.every((key) => Boolean(env[key]));
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const initialWeb = useGameStore.getInitialState();
const initialXp = 200;
type Platform = 'Web' | 'Mobile';
const scenarios = [
    { name: '木：応答先行', starter: false, responseFirst: true, lost: false, sale: false, equip: false },
    { name: '木：同期先行と装備', starter: false, responseFirst: false, lost: false, sale: false, equip: true },
    { name: '木：応答喪失後の売却', starter: false, responseFirst: false, lost: true, sale: true, equip: false },
    { name: '青：応答先行と戦闘解放', starter: true, responseFirst: true, lost: false, sale: false, equip: false },
    { name: '青：応答喪失後の同期と再送', starter: true, responseFirst: false, lost: true, sale: false, equip: false },
];
const cases = (['Web', 'Mobile'] as const).flatMap((platform) => scenarios.map((scenario) => ({ platform, ...scenario })));
function signal() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { resolve, promise };
}

describe.skipIf(!enabled)('宝箱の実送信・受信・開封結果再送（ローカルDB/Edge）', () => {
    let pg: PgClient;
    let admin: SupabaseClient;
    let client: SupabaseClient | undefined;
    let createdUserId: string | null = null;
    let game: GameCloudClient;
    let edge: EdgeFunctionInvoker;
    let woodId: string;
    let blueId: string;
    let keptId: string;
    let holdResponse: boolean;
    let loseResponse: boolean;
    let lostResponses: number;
    let committed: ReturnType<typeof signal>;
    let release: ReturnType<typeof signal>;
    let requestInFlight: Promise<string> | undefined;
    const localOpen = vi.fn(() => null);
    const received: CloudChestResult[] = [];

    beforeAll(async () => {
        // Fail before connecting or creating accounts if any destination is not loopback.
        assertLocalSyncEnvironment(env);
        admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
            auth: { ...authOptions, storageKey: `chest-admin-${crypto.randomUUID()}` },
        });
        pg = new PgClient({ connectionString: env.SUPABASE_DB_URL }); await pg.connect();
    }, 30000);
    beforeEach(async () => {
        await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); localStorage.clear(); nativeDisk.clear();
        createdUserId = null; client = undefined; holdResponse = true; loseResponse = false; lostResponses = 0;
        committed = signal(); release = signal(); requestInFlight = undefined; received.length = 0; localOpen.mockClear();
        withoutCompletionRewardPersistence(() => useGameStore.setState(initialWeb));
        useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), activeBattle: null, hasHydrated: true, pendingChestReveal: null, lastLevelUp: null });
        setGameRewardAuthorityState('authenticated');
        const email = `chest-seed-${crypto.randomUUID()}@example.com`;
        const password = 'local-test-password-123';
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error || !created.data.user) throw new Error('Disposable chest account creation failed');
        createdUserId = created.data.user.id;
        client = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
            auth: { ...authOptions, storageKey: `chest-user-${createdUserId}` },
        });
        const signedIn = await client.auth.signInWithPassword({ email, password });
        if (signedIn.error || !signedIn.data.session) throw new Error('Disposable chest account sign in failed');
        const session = signedIn.data.session;
        const transport: typeof fetch = async (input, init) => {
            const response = await fetch(input, init);
            const url = input instanceof Request ? input.url : String(input);
            if (holdResponse && response.ok && url.endsWith('/functions/v1/open_chest')) {
                holdResponse = false; committed.resolve();
                await release.promise; // The real handler has committed, but the client has not received its response.
                if (loseResponse) {
                    loseResponse = false; lostResponses += 1; await response.arrayBuffer();
                    throw new TypeError('Simulated chest response loss after commit');
                }
            }
            return response;
        };
        edge = createEdgeFunctionInvoker({ functionsUrl: env.SUPABASE_FUNCTIONS_URL!, anonKey: env.SUPABASE_ANON_KEY!,
            getSession: async () => ({ accessToken: session.access_token, userId: session.user.id }),
            refreshSession: async () => null, fetchFn: transport });
        game = createGameCloudClient({ getInvoker: () => edge });
        await notifyLogin(createdUserId);
        woodId = crypto.randomUUID(); blueId = crypto.randomUUID(); keptId = crypto.randomUUID();
        // Only this disposable owner's fixture: two unopened chests and one unrelated item.
        await pg.query('begin');
        try {
            await pg.query('select public.lock_user_sync($1)', [createdUserId]);
            const version = await pg.query('select public.next_sync_version($1) as v', [createdUserId]);
            const updated = await pg.query('update public.characters set total_xp=$2, gacha_count=5, battle_unlocked=false, version=$3 where user_id=$1', [createdUserId, initialXp, version.rows[0].v]);
            expect(updated.rowCount).toBe(1);
            for (const [id, type, starter] of [[woodId, 'wood', false], [blueId, 'blue', true]]) {
                await pg.query('insert into public.chests (id,user_id,chest_type,label,is_starter_character,version) values ($1,$2,$3,$3,$4,$5)',
                    [id, createdUserId, type, starter, version.rows[0].v]);
            }
            await pg.query('insert into public.inventory_items (id,user_id,template_id,version) values ($1,$2,$3,$4)',
                [keptId, createdUserId, 'wooden_ring', version.rows[0].v]);
            await pg.query('commit');
        } catch (error) { await pg.query('rollback'); throw error; }
    }, 30000);
    afterEach(async () => {
        release?.resolve(); await requestInFlight; client?.auth.stopAutoRefresh(); await flushCompletionRewardWrites();
        resetAuthLifecycleHooks(); setGameRewardAuthorityState('anonymous'); localStorage.clear();
        // No reset/truncate, existing accounts, or staging cleanup.
        if (createdUserId) {
            const { error } = await admin.auth.admin.deleteUser(createdUserId);
            if (error) throw new Error('Disposable chest account cleanup failed');
        }
    });
    afterAll(async () => { await pg?.end(); });

    const requestOptions = () => ({ expectedUserId: createdUserId!, isActive: () => true });
    async function pull() {
        let cache = createEmptyCloudCache(); let cursor = 0;
        for (let page = 0; page < 50; page += 1) {
            const { data, error } = await client!.rpc('pull_sync_batch', { p_after_version: cursor, p_max_versions: 100 });
            if (error) throw new Error('Chest fixture pull failed');
            const batch = data as PullBatch; cache = applyPullBatchToCache(cache, batch);
            if (!batch.has_more) return cache;
            expect(batch.next_cursor).toBeGreaterThan(cursor); cursor = batch.next_cursor;
        }
        throw new Error('Chest fixture pull exceeded page limit');
    }
    function store(platform: Platform) { return platform === 'Web' ? useGameStore.getState() : useMobileGameStore.getState(); }
    function seed(platform: Platform, cache: Awaited<ReturnType<typeof pull>>) {
        expect(platform === 'Web' ? applyCloudCacheToWebStores(cache) : applyCloudCacheToMobileStores(cache)).toBe(true);
    }
    async function run(platform: Platform, chestId: string, key: string) {
        const deps = {
            openCloudChest: async (id: string, retryKey: string) => {
                const result = await game.openChest(id, retryKey, requestOptions());
                if (result) received.push(result);
                return result;
            },
            localOpenChest: localOpen, allowLocalFallback: false,
            syncConfirmedChest: async (id: string) => {
                seed(platform, await pull());
                return store(platform).chestQueue.find((chest) => chest.id === id)?.opened === true;
            },
            discardSyncedChest: (id: string) => store(platform).discardSyncedChest(id),
        };
        if (platform === 'Web') return runWeb(chestId, key, { ...deps,
            applyCloudChestResult: (...args) => useGameStore.getState().applyCloudChestResult(...args) });
        return (await runMobile(chestId, key, { ...deps,
            applyCloudChestResult: (...args) => useMobileGameStore.getState().applyCloudChestResult(...args) })).tag;
    }
    async function assertCanonical(platform: Platform, xp: number) {
        // Compare before reseeding, so a later pull cannot hide a transient duplicate/resurrection.
        const actual = await pg.query('select id,template_id,equipped from public.inventory_items where user_id=$1 and deleted_at is null order by id', [createdUserId]);
        expect(store(platform).equipment.map((item) => ({ id: item.id, template_id: item.templateId, equipped: item.equipped }))
            .sort((a, b) => a.id.localeCompare(b.id))).toEqual(actual.rows);
        expect(store(platform).equipment.some((item) => item.id === keptId)).toBe(true);
        const chests = await pg.query('select id,opened from public.chests where user_id=$1 order by id', [createdUserId]);
        expect(store(platform).chestQueue.map(({ id, opened }) => ({ id, opened })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(chests.rows);
        const character = await pg.query('select total_xp,gacha_count,battle_unlocked from public.characters where user_id=$1', [createdUserId]);
        expect(Number(character.rows[0].total_xp)).toBe(xp); expect(Number(character.rows[0].gacha_count)).toBe(5);
        expect(store(platform).character.totalXp).toBe(xp); expect(store(platform).gachaCount).toBe(5);
        const unlocked = platform === 'Web' ? useGameStore.getState().battle.battleUnlocked : useMobileGameStore.getState().battleProgress.battleUnlocked;
        expect(unlocked).toBe(character.rows[0].battle_unlocked);
    }

    it.each(cases)('$platform：$name / 確定結果・獲得履歴・演出・XPを重ねない', async ({ platform, starter, responseFirst, lost, sale, equip }) => {
        seed(platform, await pull()); await assertCanonical(platform, initialXp);
        const chestId = starter ? blueId : woodId; const key = crypto.randomUUID();
        loseResponse = lost;
        const pending = requestInFlight = run(platform, chestId, key);
        await Promise.race([committed.promise, pending.then(() => { throw new Error('Chest request ended before successful commit'); })]);
        const receipt = await pg.query('select result from public.idempotency_keys where user_id=$1 and key=$2 and operation=$3', [createdUserId, key, 'open_chest']);
        expect(receipt.rows).toHaveLength(1);
        const recorded = receipt.rows[0].result as { item_id: string | null; template_id: string | null; starter_character: boolean; version: number };
        expect(Number.isSafeInteger(recorded.version) && recorded.version > 0).toBe(true);
        const expected = { itemId: recorded.item_id, templateId: recorded.template_id, starterCharacter: starter };
        expect(recorded.starter_character).toBe(starter);
        expect(store(platform).pendingChestReveal).toBeNull(); expect(received).toHaveLength(0);
        const opened = await pg.query('select opened,opened_item_id,version from public.chests where user_id=$1 and id=$2', [createdUserId, chestId]);
        expect(opened.rows[0]).toMatchObject({ opened: true, opened_item_id: recorded.item_id });
        expect(Number(opened.rows[0].version)).toBe(recorded.version);
        if (starter) {
            expect(recorded.item_id).toBeNull(); expect(recorded.template_id).toBeNull();
        } else {
            expect(recorded.item_id).toBeTruthy();
            const item = await pg.query('select template_id,version from public.inventory_items where user_id=$1 and id=$2 and deleted_at is null', [createdUserId, recorded.item_id]);
            expect(item.rows).toHaveLength(1); expect(item.rows[0].template_id).toBe(recorded.template_id);
            expect(Number(item.rows[0].version)).toBe(recorded.version);
        }
        if (responseFirst || lost) {
            release.resolve(); expect(await pending).toBe(lost ? 'error' : 'applied');
            if (lost) {
                expect(lostResponses).toBe(1); expect(received).toHaveLength(0);
                expect(store(platform).chestQueue.find((chest) => chest.id === chestId)?.opened).toBe(false);
                expect(store(platform).equipment.map((item) => item.id)).toEqual([keptId]);
                expect(store(platform).pendingChestReveal).toBeNull();
            } else {
                expect(received).toEqual([expected]);
                expect(store(platform).pendingChestReveal).toMatchObject({ chestId, isStarterCharacter: starter });
                expect(store(platform).pendingChestReveal?.equipment?.id ?? null).toBe(recorded.item_id);
                await assertCanonical(platform, initialXp);
            }
        }
        if (equip) {
            const equipped = await client!.rpc('set_equipped_items', { p_item_ids: [recorded.item_id!], p_key: crypto.randomUUID() });
            expect(equipped.error).toBeNull();
        }
        seed(platform, await pull()); await assertCanonical(platform, initialXp);
        let expectedXp = initialXp;
        if (sale) {
            const template = EQUIPMENT_POOL.find((candidate) => candidate.id === recorded.template_id)!; expect(template).toBeTruthy();
            const sold = await edge<{ granted: boolean; xp: number }>('sell_item', { itemId: recorded.item_id, idempotencyKey: crypto.randomUUID() }, requestOptions());
            expect(sold.granted).toBe(true); expect(sold.xp).toBe(SELL_XP_BY_RARITY[template.rarity]);
            expectedXp += sold.xp; seed(platform, await pull());
        }
        const reveal = store(platform).pendingChestReveal;
        if (!responseFirst && !lost) {
            release.resolve(); expect(await pending).toBe('applied'); expect(received).toEqual([expected]);
            expect(store(platform).pendingChestReveal).toBe(reveal);
            await assertCanonical(platform, expectedXp);
        }
        for (let replay = 0; replay < 2; replay += 1) {
            expect(await run(platform, chestId, key)).toBe('applied'); expect(received.at(-1)).toEqual(expected);
            expect(store(platform).pendingChestReveal).toBe(reveal); await assertCanonical(platform, expectedXp);
        }
        if (equip) expect(store(platform).equipment.find((item) => item.id === recorded.item_id)?.equipped).toBe(true);
        if (sale) {
            expect(store(platform).equipment.some((item) => item.id === recorded.item_id)).toBe(false);
            const tombstone = await pg.query('select deleted_at,version from public.inventory_items where user_id=$1 and id=$2', [createdUserId, recorded.item_id]);
            expect(tombstone.rows[0].deleted_at).not.toBeNull(); expect(Number(tombstone.rows[0].version)).toBeGreaterThan(recorded.version);
        }
        // A different key must still be rejected; replay success must not weaken the opened-chest guard.
        await expect(game.openChest(chestId, crypto.randomUUID(), requestOptions())).rejects.toMatchObject({ status: 409 });
        const receipts = await pg.query("select result from public.idempotency_keys where user_id=$1 and operation='open_chest'", [createdUserId]);
        expect(receipts.rows).toEqual([{ result: recorded }]);
        const sales = await pg.query("select count(*) as count, coalesce(sum(xp_delta),0) as xp from public.reward_transactions where user_id=$1 and kind='sell_item'", [createdUserId]);
        expect(Number(sales.rows[0].count)).toBe(sale ? 1 : 0); expect(Number(sales.rows[0].xp)).toBe(expectedXp - initialXp);
        seed(platform, await pull()); seed(platform, await pull()); await assertCanonical(platform, expectedXp);
        expect(store(platform).chestQueue.find((chest) => chest.id === chestId)?.equipment?.id ?? null).toBe(recorded.item_id);
        expect(store(platform).pendingChestReveal).toBe(reveal); expect(localOpen).not.toHaveBeenCalled();
    }, 30000);
    const restartCases = (['Web', 'Mobile'] as const).flatMap((platform) =>
        (['送信前', '青箱の確定後に応答喪失', '木箱の確定後に売却'] as const).map((point) => ({ platform, point })));
    it.each(restartCases)('$platform / $point / 起動し直しても一つの確定結果を受け取る', async ({ platform, point }) => {
        seed(platform, await pull());
        const chestId = point === '青箱の確定後に応答喪失' ? blueId : woodId;
        const owner = createdUserId!;
        const key = chestOpenRetryKey(owner, chestId);
        let soldId: string | null = null;
        let expectedXp = initialXp;
        if (point === '送信前') {
            holdResponse = false;
        } else {
            loseResponse = true;
            const pending = requestInFlight = run(platform, chestId, key);
            await Promise.race([committed.promise, pending.then(() => { throw new Error('Expected a committed chest'); })]);
            release.resolve();
            expect(await pending).toBe('error');
            expect(lostResponses).toBe(1);
            if (point === '木箱の確定後に売却') {
                const { rows } = await pg.query('select opened_item_id from public.chests where id=$1', [chestId]);
                soldId = rows[0].opened_item_id;
                expect(soldId).toBeTruthy();
                const sold = await edge<{ granted: boolean; xp: number }>('sell_item', {
                    itemId: soldId, idempotencyKey: crypto.randomUUID(),
                }, requestOptions());
                expect(sold.granted).toBe(true);
                expectedXp += sold.xp;
            }
        }

        await flushCompletionRewardWrites();
        const saveKey = 'quest-board-game';
        const snapshot = platform === 'Web' ? localStorage.getItem(saveKey) : nativeDisk.get(saveKey);
        expect(snapshot).toBeTruthy();
        if (platform === 'Web') {
            withoutCompletionRewardPersistence(() => useGameStore.setState(initialWeb));
            localStorage.setItem(saveKey, snapshot!);
            await useGameStore.persist.rehydrate();
        } else {
            useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: false });
            nativeDisk.set(saveKey, snapshot!);
            await useMobileGameStore.persist.rehydrate();
        }
        const restored = store(platform).chestQueue.find((chest) => chest.id === chestId)!;
        expect(restored).toMatchObject({ opened: false, origin: 'cloud' });
        expect(store(platform).pendingChestReveal).toBeNull();
        expect(store(platform).equipment.map((item) => item.id)).toEqual([keptId]);
        const retryKey = chestOpenRetryKey(owner, restored.id);
        expect(retryKey).toBe(key);
        const fresh = point === '送信前';
        expect(await run(platform, restored.id, retryKey)).toBe(fresh ? 'applied' : 'confirmed');
        expect(received).toHaveLength(1);
        expect(received[0].requiresCanonicalSync).toBe(fresh ? undefined : true);
        expect(store(platform).pendingChestReveal?.chestId ?? null).toBe(fresh ? chestId : null);
        await assertCanonical(platform, expectedXp);
        if (soldId) {
            expect(store(platform).equipment.some((item) => item.id === soldId)).toBe(false);
            expect(store(platform).chestQueue.find((chest) => chest.id === chestId)?.equipment?.id).toBe(soldId);
        }
        const receipts = await pg.query("select key from public.idempotency_keys where user_id=$1 and operation='open_chest'", [owner]);
        expect(receipts.rows).toEqual([{ key }]);
        expect(localOpen).not.toHaveBeenCalled();
    }, 30000);

    it('classifies the initial blue chest and the same-key SQL replay with no item ID', async () => {
        const owner = createdUserId!;
        const key = chestOpenRetryKey(owner, blueId);
        const open = () => admin.rpc('open_chest_apply', {
            p_user_id: owner, p_chest_id: blueId, p_item: null, p_key: key,
        });
        const results = await Promise.all([open(), open()]);
        for (const result of results) expect(result.error).toBeNull();
        const fresh = results.find(({ data }) => data.replayed === false)?.data;
        const replay = results.find(({ data }) => data.replayed === true)?.data;
        expect(fresh).toMatchObject({ item_id: null, template_id: null, starter_character: true });
        expect(replay).toEqual({ ...fresh, replayed: true });
        const receipts = await pg.query('select result from public.idempotency_keys where user_id=$1 and key=$2', [owner, key]);
        expect(receipts.rows).toHaveLength(1);
        expect(receipts.rows[0].result).not.toHaveProperty('replayed');
        expect(receipts.rows[0].result).toMatchObject({ version: fresh.version, starter_character: true });
        seed('Web', await pull());
        await assertCanonical('Web', initialXp);
        expect(useGameStore.getState().battle.battleUnlocked).toBe(true);
    }, 30000);

});
