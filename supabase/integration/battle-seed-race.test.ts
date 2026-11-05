// @vitest-environment jsdom
/** Real local DB/Edge → pull/cache → production Web/Mobile stores.
 * Only Native disk and delivery timing are simulated; no staging or device UI.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client as PgClient } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import type { PullBatch } from '@life-quest/core/cloudPull';
import { createEdgeFunctionInvoker } from '@life-quest/core/edgeFunctions';
import { createGameCloudClient, type CloudBattleAttempt, type GameCloudClient, type ResolveBattleAttemptResponse } from '@life-quest/core/gameCloud';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { assertLocalSyncEnvironment, syncEnvironmentKeys } from '../../scripts/run-sync-quality.mjs';
import { applyCloudCacheToWebStores } from '../../src/platform/cloudSync';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from '../../src/platform/completionRewards';
import { useGameStore } from '../../src/stores/useGameStore';
import { useBattleHistoryStore } from '../../src/stores/useBattleHistoryStore';
import { applyCloudCacheToMobileStores } from '../../apps/mobile/src/platform/cloudSeed';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));

const env = process.env;
const enabled = syncEnvironmentKeys.every((key) => Boolean(env[key]));
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const initialWeb = useGameStore.getInitialState();
const initialXp = 500;
type Platform = 'Web' | 'Mobile';
type Delivery = '同期が先' | '応答が先' | '確定後に応答喪失';
const cases = (['Web', 'Mobile'] as const).flatMap((platform) =>
    (['同期が先', '応答が先', '確定後に応答喪失'] as const).map((delivery) => ({ platform, delivery })));

describe.skipIf(!enabled)('戦闘結果と実pullの競合（ローカルDB/Edge）', () => {
    let pg: PgClient;
    let admin: SupabaseClient;
    let client: SupabaseClient | undefined;
    let createdUserId: string | null = null;
    let game: GameCloudClient;
    let loseResponse = false;
    let lostResponses = 0;

    beforeAll(async () => {
        // Validate every URL before admin.createUser, database connection or any mutation.
        assertLocalSyncEnvironment(env);
        admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, options);
        pg = new PgClient({ connectionString: env.SUPABASE_DB_URL });
        await pg.connect();
    }, 30000);
    beforeEach(async () => {
        await flushCompletionRewardWrites();
        resetAuthLifecycleHooks(); localStorage.clear();
        createdUserId = null; client = undefined; loseResponse = false; lostResponses = 0;
        withoutCompletionRewardPersistence(() => useGameStore.setState(initialWeb));
        useBattleHistoryStore.setState({ history: [] });
        useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), activeBattle: null, hasHydrated: true });
        setGameRewardAuthorityState('authenticated');
        const email = `battle-seed-${crypto.randomUUID()}@example.com`;
        const password = 'local-test-password-123';
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error || !created.data.user) throw new Error('Disposable battle account creation failed');
        createdUserId = created.data.user.id;
        client = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, options);
        const signedIn = await client.auth.signInWithPassword({ email, password });
        if (signedIn.error || !signedIn.data.session) throw new Error('Disposable battle account sign in failed');
        const session = signedIn.data.session;
        const transport: typeof fetch = async (input, init) => {
            const response = await fetch(input, init);
            const url = input instanceof Request ? input.url : String(input);
            if (loseResponse && response.ok && url.endsWith('/functions/v1/resolve_battle_attempt')) {
                loseResponse = false; lostResponses += 1;
                await response.arrayBuffer(); // The server committed; only delivery is lost.
                throw new TypeError('Simulated battle response loss after commit');
            }
            return response;
        };
        const edge = createEdgeFunctionInvoker({ functionsUrl: env.SUPABASE_FUNCTIONS_URL!, anonKey: env.SUPABASE_ANON_KEY!,
            getSession: async () => ({ accessToken: session.access_token, userId: session.user.id }),
            refreshSession: async () => null, fetchFn: transport });
        game = createGameCloudClient({ getInvoker: () => edge });
        await notifyLogin(createdUserId);
        // Fixture only: unlock a past stage, with a different server-preferred stage.
        await pg.query('begin');
        try {
            await pg.query('select public.lock_user_sync($1)', [createdUserId]);
            const version = await pg.query('select public.next_sync_version($1) as v', [createdUserId]);
            const updated = await pg.query(`update public.characters set total_xp=$2, battle_unlocked=true,
                max_cleared_stage=3, current_stage=4, version=$3 where user_id=$1`,
            [createdUserId, initialXp, version.rows[0].v]);
            expect(updated.rowCount).toBe(1);
            await pg.query('commit');
        } catch (error) { await pg.query('rollback'); throw error; }
    }, 30000);
    afterEach(async () => {
        client?.auth.stopAutoRefresh();
        await flushCompletionRewardWrites();
        resetAuthLifecycleHooks(); setGameRewardAuthorityState('anonymous'); localStorage.clear();
        if (createdUserId) {
            const { error } = await admin.auth.admin.deleteUser(createdUserId);
            if (error) throw new Error('Disposable battle account cleanup failed');
        }
    });
    afterAll(async () => { await pg?.end(); });

    async function pull() {
        let cache = createEmptyCloudCache();
        let cursor = 0;
        for (let page = 0; page < 50; page += 1) {
            const { data, error } = await client!.rpc('pull_sync_batch', { p_after_version: cursor, p_max_versions: 100 });
            if (error) throw new Error('Battle fixture pull failed');
            const batch = data as PullBatch;
            cache = applyPullBatchToCache(cache, batch);
            if (!batch.has_more) return cache;
            expect(batch.next_cursor).toBeGreaterThan(cursor);
            cursor = batch.next_cursor;
        }
        throw new Error('Battle fixture pull exceeded page limit');
    }
    function seed(platform: Platform, cache: Awaited<ReturnType<typeof pull>>) {
        expect(platform === 'Web' ? applyCloudCacheToWebStores(cache) : applyCloudCacheToMobileStores(cache)).toBe(true);
    }
    function startAndWin(platform: Platform, attempt: CloudBattleAttempt) {
        const { actors, battleAttemptId } = attempt;
        if (platform === 'Web') {
            useGameStore.getState().startCloudBattle(1, battleAttemptId,
                { ...actors.player, level: actors.playerLevel, name: actors.playerName },
                { ...actors.enemy, hp: actors.enemy.maxHp });
            for (let turn = 0; turn < 100 && useGameStore.getState().battle.status === 'fighting'; turn += 1) {
                useGameStore.getState().processBattleTurn();
            }
            expect(useGameStore.getState().battle.status).toBe('victory');
            expect(useGameStore.getState().battle.battleAttemptId).toBe(battleAttemptId);
            return useGameStore.getState().battle.actions;
        }
        useMobileGameStore.getState().startCloudBattle(1, battleAttemptId, actors);
        for (let turn = 0; turn < 100 && useMobileGameStore.getState().activeBattle?.state.outcome === 'ongoing'; turn += 1) {
            useMobileGameStore.getState().performBattleAction({ type: 'attack' });
        }
        expect(useMobileGameStore.getState().activeBattle?.state.outcome).toBe('victory');
        expect(useMobileGameStore.getState().activeBattle?.battleAttemptId).toBe(battleAttemptId);
        return useMobileGameStore.getState().activeBattle!.actions;
    }
    function deliver(platform: Platform, id: string, response: ResolveBattleAttemptResponse) {
        // Exercise the real store's last line of defence, even if a delayed caller reaches it.
        const store = platform === 'Web' ? useGameStore.getState() : useMobileGameStore.getState();
        store.applyResolvedCloudBattle(id, response.outcome, response.granted);
    }
    function assertSettled(platform: Platform, expectedXp: number) {
        if (platform === 'Web') {
            const state = useGameStore.getState();
            expect(state.character.totalXp).toBe(expectedXp);
            expect(state.battle).toMatchObject({ status: 'victory', currentStage: 1, maxClearedStage: 3, battleAttemptId: null });
            expect(state.battle.enemy?.hp).toBe(0);
            expect(useBattleHistoryStore.getState().history).toHaveLength(1);
            expect(useBattleHistoryStore.getState().history[0]).toMatchObject({ stage: 1, outcome: 'victory', xpEarned: expectedXp - initialXp });
        } else {
            const state = useMobileGameStore.getState();
            expect(state.character.totalXp).toBe(expectedXp);
            expect(state.activeBattle).toMatchObject({ stage: 1, battleAttemptId: null, state: { outcome: 'victory', enemyHp: 0 } });
            expect(state.battleProgress.maxClearedStage).toBe(3);
        }
    }

    it.each(cases)('$platform：$deliveryでも報酬は1回、再送・反復pullでも結果を維持する', async ({ platform, delivery }: { platform: Platform; delivery: Delivery }) => {
        seed(platform, await pull());
        const attempt = await game.startBattleAttempt(1, crypto.randomUUID(), createdUserId!);
        expect(attempt).not.toBeNull();
        const actions = startAndWin(platform, attempt!);
        expect((platform === 'Web' ? useGameStore.getState() : useMobileGameStore.getState()).character.totalXp).toBe(initialXp);
        const key = crypto.randomUUID();
        const resolve = (idempotencyKey: string) => game.resolveBattleAttempt(attempt!.battleAttemptId, actions,
            { expectedUserId: createdUserId!, idempotencyKey });
        let response: ResolveBattleAttemptResponse | undefined;
        if (delivery === '確定後に応答喪失') {
            loseResponse = true;
            await expect(resolve(key)).rejects.toThrow();
            expect(lostResponses).toBe(1);
        } else {
            response = await resolve(key);
            expect(response).toMatchObject({ outcome: 'victory', granted: true });
        }
        const expectedXp = initialXp + attempt!.actors.enemy.xpReward;
        const cache = await pull();
        // Verify the actual SQL/pull contract used to acknowledge a seeded result.
        const db = await pg.query(`select c.total_xp, c.current_stage, c.version as character_version,
            a.version as attempt_version, a.status, a.outcome from public.characters c
            join public.battle_attempts a on a.user_id=c.user_id where c.user_id=$1 and a.id=$2`,
        [createdUserId, attempt!.battleAttemptId]);
        expect(Number(db.rows[0].total_xp)).toBe(expectedXp);
        expect(Number(db.rows[0].current_stage)).toBe(4);
        expect(Number(db.rows[0].character_version)).toBeGreaterThan(0);
        expect(db.rows[0].character_version).toBe(db.rows[0].attempt_version);
        expect(db.rows[0]).toMatchObject({ status: 'resolved', outcome: 'victory' });
        if (delivery === '応答が先') {
            deliver(platform, attempt!.battleAttemptId, response!);
            assertSettled(platform, expectedXp);
        }
        seed(platform, cache);
        assertSettled(platform, expectedXp); // No response has reached the seed-first/lost-response store yet.
        if (response && delivery === '同期が先') {
            deliver(platform, attempt!.battleAttemptId, response);
            assertSettled(platform, expectedXp);
        }
        // The public Edge short-circuits a resolved attempt before SQL key replay.
        const replay = await resolve(key);
        expect(replay).toMatchObject({ outcome: 'victory', granted: false, already_resolved: true });
        deliver(platform, attempt!.battleAttemptId, replay);
        assertSettled(platform, expectedXp);
        const otherKey = await resolve(crypto.randomUUID());
        expect(otherKey).toMatchObject({ outcome: 'victory', granted: false, already_resolved: true });
        deliver(platform, attempt!.battleAttemptId, otherKey);
        assertSettled(platform, expectedXp);
        seed(platform, await pull()); seed(platform, cache);
        assertSettled(platform, expectedXp);
        const rewards = await pg.query(`select count(*) as count, sum(xp_delta) as xp from public.reward_transactions
            where user_id=$1 and kind='battle_reward' and source_id=$2`, [createdUserId, attempt!.battleAttemptId]);
        expect(Number(rewards.rows[0].count)).toBe(1);
        expect(Number(rewards.rows[0].xp)).toBe(attempt!.actors.enemy.xpReward);
        const character = await pg.query('select total_xp from public.characters where user_id=$1', [createdUserId]);
        expect(Number(character.rows[0].total_xp)).toBe(expectedXp);
    }, 30000);
});
