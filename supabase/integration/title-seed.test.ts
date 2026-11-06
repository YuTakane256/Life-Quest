// @vitest-environment jsdom
/** Real local profile RPC/pull through two JWT clients into Web/Mobile title stores. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { applyPullBatchToCache, createEmptyCloudCache, getSeedableSections, type CloudCache } from '@life-quest/core/cloudCache';
import type { PullBatch } from '@life-quest/core/cloudPull';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { assertLocalSyncEnvironment, syncEnvironmentKeys } from '../../scripts/run-sync-quality.mjs';
import { applyCloudCacheToWebStores } from '../../src/platform/cloudSync';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from '../../src/platform/completionRewards';
import { useGameStore } from '../../src/stores/useGameStore';
import { useTitleStore } from '../../src/stores/useTitleStore';
import { applyCloudCacheToMobileStores } from '../../apps/mobile/src/platform/cloudSeed';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';
import { useMobileTitleStore } from '../../apps/mobile/src/stores/useMobileTitleStore';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
const env = process.env;
const enabled = syncEnvironmentKeys.every((key) => Boolean(env[key]));
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const initialWeb = useGameStore.getInitialState();

describe.skipIf(!enabled)('称号だけの双方向受信（ローカルRPC/RLS/実ストア）', () => {
    let admin: SupabaseClient;
    let createdUserId: string | null = null;
    const clients: SupabaseClient[] = [];
    beforeAll(() => {
        assertLocalSyncEnvironment(env); // Before any connection/account creation.
        admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { ...auth, storageKey: `title-admin-${crypto.randomUUID()}` } });
    });
    beforeEach(async () => {
        await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); localStorage.clear(); createdUserId = null;
        withoutCompletionRewardPersistence(() => useGameStore.setState(initialWeb));
        useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, activeBattle: null });
        await useMobileTitleStore.persist.rehydrate();
        useTitleStore.setState({ activeTitle: '以前の称号' }); useMobileTitleStore.setState({ activeTitle: '以前の称号' });
        setGameRewardAuthorityState('authenticated');
    });
    afterEach(async () => {
        clients.splice(0).forEach((client) => client.auth.stopAutoRefresh());
        await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); setGameRewardAuthorityState('anonymous'); localStorage.clear();
        if (createdUserId) {
            const deleted = await admin.auth.admin.deleteUser(createdUserId);
            if (deleted.error) throw new Error('Disposable title account cleanup failed');
        }
    });

    it.each(['WebからMobile', 'MobileからWeb'])('%s：初期ゲームを保ち、称号更新と解除を受信する', async (direction) => {
        const email = `title-seed-${crypto.randomUUID()}@example.com`; const password = 'local-test-password-123';
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error || !created.data.user) throw new Error('Disposable title account creation failed');
        createdUserId = created.data.user.id;
        await notifyLogin(createdUserId);
        async function device(name: string) {
            const client = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, { auth: { ...auth, storageKey: `title-${name}-${crypto.randomUUID()}` } });
            clients.push(client);
            const signedIn = await client.auth.signInWithPassword({ email, password });
            if (signedIn.error || !signedIn.data.session) throw new Error('Disposable title sign in failed');
            let cache: CloudCache = createEmptyCloudCache(); let cursor = 0;
            return { client, async pull() {
                for (let page = 0; page < 50; page += 1) {
                    const { data, error } = await client.rpc('pull_sync_batch', { p_after_version: cursor, p_max_versions: 100 });
                    if (error) throw new Error('Title fixture pull failed');
                    const batch = data as PullBatch; cache = applyPullBatchToCache(cache, batch);
                    expect(batch.next_cursor).toBeGreaterThanOrEqual(cursor); cursor = batch.next_cursor;
                    if (!batch.has_more) return cache;
                }
                throw new Error('Title fixture exceeded page limit');
            }, async setTitle(value: string | null) {
                const { error } = await client.rpc('upsert_profile', { p_display_name: null, p_avatar: null,
                    p_active_title: value, p_base_version: null, p_key: crypto.randomUUID() });
                if (error) throw new Error('Title fixture RPC failed');
            } };
        }
        const web = await device('web'); const mobile = await device('mobile');
        const beforeWeb = useGameStore.getState(); const beforeMobile = useMobileGameStore.getState();
        expect(applyCloudCacheToWebStores(await web.pull())).toBe(false);
        expect(applyCloudCacheToMobileStores(await mobile.pull())).toBe(false);
        expect(useTitleStore.getState().activeTitle).toBe('以前の称号'); expect(useMobileTitleStore.getState().activeTitle).toBe('以前の称号');
        const first = direction === 'WebからMobile' ? web : mobile;
        const second = direction === 'WebからMobile' ? mobile : web;
        await first.setTitle('努力の人');
        const received = await second.pull();
        expect(getSeedableSections(received)).toMatchObject({ game: false, title: true });
        expect(second === mobile ? applyCloudCacheToMobileStores(received) : applyCloudCacheToWebStores(received)).toBe(true);
        expect((second === mobile ? useMobileTitleStore : useTitleStore).getState().activeTitle).toBe('努力の人');
        await second.setTitle('冒険者');
        const reply = await first.pull();
        expect(first === mobile ? applyCloudCacheToMobileStores(reply) : applyCloudCacheToWebStores(reply)).toBe(true);
        expect((first === mobile ? useMobileTitleStore : useTitleStore).getState().activeTitle).toBe('冒険者');
        await first.setTitle(null);
        for (const [device, seed, title] of [
            [web, applyCloudCacheToWebStores, useTitleStore], [mobile, applyCloudCacheToMobileStores, useMobileTitleStore],
        ] as const) {
            const cleared = await device.pull(); seed(cleared); seed(cleared);
            expect(title.getState().activeTitle).toBeNull();
            expect(cleared.characters[createdUserId].version).toBe(1);
        }
        expect(useGameStore.getState()).toBe(beforeWeb); expect(useMobileGameStore.getState()).toBe(beforeMobile);
        const profile = await web.client.from('profiles').select('active_title').eq('user_id', createdUserId).single();
        expect(profile.error).toBeNull(); expect(profile.data?.active_title).toBeNull();
    }, 30000);
});
