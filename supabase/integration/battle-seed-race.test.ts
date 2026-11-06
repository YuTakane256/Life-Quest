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
import { replayBattle, type BattleAction, type BattleEngineState } from '@life-quest/core/battle';
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
type Mode = '通常攻撃で勝利' | 'スキルで勝利' | 'スキルで敗北';
const cases = (['Web', 'Mobile'] as const).flatMap((platform) =>
    (['通常攻撃で勝利', 'スキルで勝利', 'スキルで敗北'] as const).flatMap((mode) =>
        (['同期が先', '応答が先', '確定後に応答喪失'] as const).map((delivery) => ({ platform, mode, delivery }))));

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
    function runtime(platform: Platform): BattleEngineState {
        if (platform === 'Mobile') return useMobileGameStore.getState().activeBattle!.state;
        const battle = useGameStore.getState().battle;
        return { enemyHp: battle.enemy!.hp, playerHp: battle.playerHp, logs: battle.logs,
            skillCooldowns: battle.skillCooldowns, guardTurnsRemaining: battle.guardTurnsRemaining,
            guardDamageReduction: battle.guardDamageReduction,
            outcome: battle.status === 'fighting' || battle.status === 'idle' ? 'ongoing' : battle.status };
    }
    function recordedActions(platform: Platform) {
        return platform === 'Web' ? useGameStore.getState().battle.actions : useMobileGameStore.getState().activeBattle!.actions;
    }
    function perform(platform: Platform, action: BattleAction) {
        if (platform === 'Mobile') useMobileGameStore.getState().performBattleAction(action);
        else if (action.type === 'skill') useGameStore.getState().activateBattleSkill(action.skillId);
        else useGameStore.getState().processBattleTurn();
    }
    function startAndFinish(platform: Platform, attempt: CloudBattleAttempt, mode: Mode) {
        const { actors, battleAttemptId } = attempt;
        const stage = actors.enemy.stage;
        if (platform === 'Web') {
            useGameStore.getState().startCloudBattle(stage, battleAttemptId,
                { ...actors.player, level: actors.playerLevel, name: actors.playerName },
                { ...actors.enemy, hp: actors.enemy.maxHp });
        } else useMobileGameStore.getState().startCloudBattle(stage, battleAttemptId, actors);
        if (mode !== '通常攻撃で勝利') {
            expect(actors.playerLevel).toBeGreaterThanOrEqual(5);
            perform(platform, { type: 'skill', skillId: 'guard_stance' });
            const afterGuard = runtime(platform); const actions = recordedActions(platform);
            expect(actions).toEqual([{ type: 'skill', skillId: 'guard_stance' }]);
            expect(afterGuard.guardTurnsRemaining).toBeGreaterThan(0);
            perform(platform, { type: 'skill', skillId: 'guard_stance' }); // Still on cooldown.
            perform(platform, { type: 'skill', skillId: 'unknown-skill' });
            expect(runtime(platform)).toEqual(afterGuard); expect(recordedActions(platform)).toBe(actions);
            perform(platform, { type: 'skill', skillId: 'first_aid' });
            perform(platform, { type: 'skill', skillId: 'power_strike' });
            expect(recordedActions(platform).slice(0, 3)).toEqual([
                { type: 'skill', skillId: 'guard_stance' }, { type: 'skill', skillId: 'first_aid' }, { type: 'skill', skillId: 'power_strike' },
            ]);
        }
        for (let turn = 0; turn < 100 && runtime(platform).outcome === 'ongoing'; turn += 1) perform(platform, { type: 'attack' });
        const actions = recordedActions(platform);
        const replay = replayBattle(actors, actions);
        expect(replay.hadInvalidAction).toBe(false);
        expect(runtime(platform)).toEqual(replay.state);
        expect(replay.outcome).toBe(mode === 'スキルで敗北' ? 'defeat' : 'victory');
        return actions;
    }
    function deliver(platform: Platform, id: string, response: ResolveBattleAttemptResponse) {
        // Exercise the real store's last line of defence, even if a delayed caller reaches it.
        const store = platform === 'Web' ? useGameStore.getState() : useMobileGameStore.getState();
        store.applyResolvedCloudBattle(id, response.outcome, response.granted);
    }
    function assertSettled(platform: Platform, expectedXp: number, mode: Mode) {
        const defeat = mode === 'スキルで敗北'; const stage = defeat ? 20 : 1;
        const outcome = defeat ? 'defeat' : 'victory'; const maxClearedStage = defeat ? 19 : 3;
        if (platform === 'Web') {
            const state = useGameStore.getState();
            expect(state.character.totalXp).toBe(expectedXp);
            expect(state.battle).toMatchObject({ status: outcome, currentStage: stage, maxClearedStage, battleAttemptId: null });
            if (defeat) expect(state.battle.playerHp).toBe(0); else expect(state.battle.enemy?.hp).toBe(0);
            expect(useBattleHistoryStore.getState().history).toHaveLength(1);
            expect(useBattleHistoryStore.getState().history[0]).toMatchObject({ stage, outcome, xpEarned: expectedXp - initialXp, logs: state.battle.logs });
        } else {
            const state = useMobileGameStore.getState();
            expect(state.character.totalXp).toBe(expectedXp);
            expect(state.activeBattle).toMatchObject({ stage, battleAttemptId: null, state: { outcome } });
            if (defeat) expect(state.activeBattle?.state.playerHp).toBe(0); else expect(state.activeBattle?.state.enemyHp).toBe(0);
            expect(state.battleProgress.maxClearedStage).toBe(maxClearedStage);
        }
    }

    it.each(cases)('$platform：$mode・$delivery / 正しい勝敗と報酬を再送・反復pullでも維持する', async ({ platform, mode, delivery }: { platform: Platform; mode: Mode; delivery: Delivery }) => {
        const defeat = mode === 'スキルで敗北'; const stage = defeat ? 20 : 1;
        const outcome = defeat ? 'defeat' : 'victory';
        if (defeat) {
            // This test's disposable fixture only: a weak character revisiting an unlocked hard stage.
            await pg.query('begin');
            try {
                await pg.query('select public.lock_user_sync($1)', [createdUserId]);
                const version = await pg.query('select public.next_sync_version($1) as v', [createdUserId]);
                await pg.query('update public.characters set max_cleared_stage=19,current_stage=20,version=$2 where user_id=$1', [createdUserId, version.rows[0].v]);
                await pg.query('commit');
            } catch (error) { await pg.query('rollback'); throw error; }
        }
        seed(platform, await pull());
        const attempt = await game.startBattleAttempt(stage, crypto.randomUUID(), createdUserId!);
        expect(attempt).not.toBeNull();
        const actions = startAndFinish(platform, attempt!, mode);
        expect((platform === 'Web' ? useGameStore.getState() : useMobileGameStore.getState()).character.totalXp).toBe(initialXp);
        const key = crypto.randomUUID();
        const resolve = (idempotencyKey: string) => game.resolveBattleAttempt(attempt!.battleAttemptId, actions,
            { expectedUserId: createdUserId!, idempotencyKey, isActive: () => true });
        if (mode !== '通常攻撃で勝利') {
            const before = await pg.query('select status,outcome,version from public.battle_attempts where id=$1 and user_id=$2', [attempt!.battleAttemptId, createdUserId]);
            const forged = [actions[0], actions[0], ...actions.slice(1)]; // A cooldown violation the clients refused to record.
            await expect(game.resolveBattleAttempt(attempt!.battleAttemptId, forged,
                { expectedUserId: createdUserId!, idempotencyKey: crypto.randomUUID(), isActive: () => true })).rejects.toMatchObject({ status: 422 });
            const after = await pg.query('select status,outcome,version from public.battle_attempts where id=$1 and user_id=$2', [attempt!.battleAttemptId, createdUserId]);
            expect(after.rows).toEqual(before.rows); expect(after.rows[0].status).toBe('in_progress');
        }
        let response: ResolveBattleAttemptResponse | undefined;
        if (delivery === '確定後に応答喪失') {
            loseResponse = true;
            await expect(resolve(key)).rejects.toThrow();
            expect(lostResponses).toBe(1);
        } else {
            response = await resolve(key);
            expect(response).toMatchObject({ outcome, granted: !defeat });
        }
        const expectedXp = initialXp + (defeat ? 0 : attempt!.actors.enemy.xpReward);
        const cache = await pull();
        // Verify the actual SQL/pull contract used to acknowledge a seeded result.
        const db = await pg.query(`select c.total_xp, c.current_stage, c.version as character_version,
            a.version as attempt_version, a.status, a.outcome from public.characters c
            join public.battle_attempts a on a.user_id=c.user_id where c.user_id=$1 and a.id=$2`,
        [createdUserId, attempt!.battleAttemptId]);
        expect(Number(db.rows[0].total_xp)).toBe(expectedXp);
        expect(Number(db.rows[0].current_stage)).toBe(defeat ? 20 : 4);
        expect(Number(db.rows[0].character_version)).toBeGreaterThan(0);
        if (defeat) expect(Number(db.rows[0].character_version)).toBeLessThan(Number(db.rows[0].attempt_version));
        else expect(db.rows[0].character_version).toBe(db.rows[0].attempt_version);
        expect(db.rows[0]).toMatchObject({ status: 'resolved', outcome });
        if (delivery === '応答が先') {
            deliver(platform, attempt!.battleAttemptId, response!);
            assertSettled(platform, expectedXp, mode);
        }
        seed(platform, cache);
        assertSettled(platform, expectedXp, mode); // No response has reached the seed-first/lost-response store yet.
        if (response && delivery === '同期が先') {
            deliver(platform, attempt!.battleAttemptId, response);
            assertSettled(platform, expectedXp, mode);
        }
        // The public Edge short-circuits a resolved attempt before SQL key replay.
        const replay = await resolve(key);
        expect(replay).toMatchObject({ outcome, granted: false, already_resolved: true });
        deliver(platform, attempt!.battleAttemptId, replay);
        assertSettled(platform, expectedXp, mode);
        const otherKey = await resolve(crypto.randomUUID());
        expect(otherKey).toMatchObject({ outcome, granted: false, already_resolved: true });
        deliver(platform, attempt!.battleAttemptId, otherKey);
        assertSettled(platform, expectedXp, mode);
        seed(platform, await pull()); seed(platform, cache);
        assertSettled(platform, expectedXp, mode);
        const rewards = await pg.query(`select count(*) as count, coalesce(sum(xp_delta),0) as xp from public.reward_transactions
            where user_id=$1 and kind='battle_reward' and source_id=$2`, [createdUserId, attempt!.battleAttemptId]);
        expect(Number(rewards.rows[0].count)).toBe(defeat ? 0 : 1);
        expect(Number(rewards.rows[0].xp)).toBe(expectedXp - initialXp);
        const character = await pg.query('select total_xp from public.characters where user_id=$1', [createdUserId]);
        expect(Number(character.rows[0].total_xp)).toBe(expectedXp);
    }, 30000);
});
