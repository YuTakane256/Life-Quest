import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { applyPullBatchToCache, createEmptyCloudCache, type CloudCache } from '@life-quest/core/cloudCache';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import type { Equipment } from '@life-quest/core/equipment';
import { applyCloudCacheToWebStores } from './cloudSync';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from './completionRewards';
import { useGameStore } from '../stores/useGameStore';
import { runCloudItemSynthesis } from '../hooks/useCloudItemSynthesis';
import { applyCloudCacheToMobileStores } from '../../apps/mobile/src/platform/cloudSeed';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';
import { runCloudSynthesis } from '../../apps/mobile/src/hooks/useCloudItemSynthesis';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
// Only the Native hook's transport/auth imports are stubbed; the decision runner,
// game stores, cache and both canonical seed paths below are production code.
vi.mock('../../apps/mobile/src/platform/battleCloud', () => ({ synthesizeCloudItems: vi.fn() }));
vi.mock('../../apps/mobile/src/platform/auth', () => ({ getGameAuthState: vi.fn() }));

const initialWeb = useGameStore.getInitialState();
const ids = ['ingredient-1', 'ingredient-2', 'ingredient-3'];
const result = { resultId: 'result', templateId: 'iron_sword' };
const row = (id: string, template = 'wooden_sword', version = 10, deleted = false, equipped = false) => ({
    id, user_id: 'a', template_id: template, equipped, version, deleted_at: deleted ? '2026-11-06T00:00:00Z' : null,
});
function initialCache() {
    return applyPullBatchToCache(createEmptyCloudCache(), { next_cursor: 10, has_more: false,
        characters: [{ user_id: 'a', total_xp: 200, gacha_count: 3, version: 10 }],
        inventory_items: [...ids.map((id) => row(id)), row('kept')],
    });
}
function synthesized(cache: CloudCache, equipped = false) {
    return applyPullBatchToCache(cache, { next_cursor: 20, has_more: false,
        inventory_items: [...ids.map((id) => row(id, 'wooden_sword', 20, true)), row('result', 'iron_sword', 20, false, equipped)],
    });
}
const platforms = [
    { name: 'Web', get: useGameStore.getState, seed: applyCloudCacheToWebStores,
        run: async (deps: Parameters<typeof runCloudItemSynthesis>[2]) => (await runCloudItemSynthesis(ids, 'same-key', deps)).equipment },
    { name: 'Mobile', get: useMobileGameStore.getState, seed: applyCloudCacheToMobileStores,
        run: async (deps: Parameters<typeof runCloudSynthesis>[2]) => (await runCloudSynthesis(ids, 'same-key', deps)).equipment },
];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }

beforeEach(async () => {
    await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); await notifyLogin('a'); localStorage.clear();
    setGameRewardAuthorityState('authenticated');
    withoutCompletionRewardPersistence(() => useGameStore.setState(initialWeb));
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, activeBattle: null, pendingChestReveal: null, lastLevelUp: null });
});
afterEach(async () => { await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); setGameRewardAuthorityState('anonymous'); localStorage.clear(); });

describe.each(platforms)('$name：合成の古い応答と実canonical反映', ({ get, seed, run }) => {
    const apply = (templateId = result.templateId) => get().applyCloudSynthesisResult(ids, result.resultId, templateId);
    function startPending() {
        const response = deferred<typeof result>();
        const local = vi.fn((): Equipment | null => null);
        const pending = run({ synthesizeCloudItems: () => response.promise,
            applyCloudSynthesisResult: (ingredients, id, template) => get().applyCloudSynthesisResult(ingredients, id, template),
            localSynthesizeItems: local, allowLocalFallback: false });
        return { response, pending, local };
    }
    it('通常の応答は素材を一度消費し、同じ結果の再適用でも重複しない', () => {
        expect(seed(initialCache())).toBe(true);
        expect(apply()?.id).toBe('result'); expect(apply()?.id).toBe('result');
        expect(get().equipment.map((item) => item.id).sort()).toEqual(['kept', 'result']);
        expect(get().character.totalXp).toBe(200);
    });
    it('同期が先に届いた場合、装備済みの結果を同じオブジェクトのまま返す', async () => {
        const cache = initialCache(); seed(cache); const { response, pending, local } = startPending();
        seed(synthesized(cache, true)); const pulled = get().equipment.find((item) => item.id === 'result')!;
        response.resolve(result); expect(await pending).toBe(pulled); expect(pulled.equipped).toBe(true);
        expect(get().equipment.map((item) => item.id).sort()).toEqual(['kept', 'result']); expect(local).not.toHaveBeenCalled();
    });
    it('結果を同期後に売却した状態を、遅い初回応答や再適用で復活させない', async () => {
        const cache = initialCache(); seed(cache); const { response, pending, local } = startPending();
        const next = applyPullBatchToCache(synthesized(cache), { next_cursor: 30, has_more: false,
            characters: [{ user_id: 'a', total_xp: 245, gacha_count: 3, version: 30 }],
            inventory_items: [row('result', 'iron_sword', 30, true)],
        });
        seed(next); const before = get().equipment;
        response.resolve(result); expect(await pending).toBeNull(); // Assert before any later seed could repair a resurrection.
        expect(apply()).toBeNull(); expect(get().equipment).toEqual(before);
        expect(get().equipment.map((item) => item.id)).toEqual(['kept']); expect(get().character.totalXp).toBe(245);
        expect(local).not.toHaveBeenCalled();
    });
    it('さらに別の合成で結果が消費された状態でも、古い装備を作り直さない', async () => {
        const cache = initialCache(); seed(cache); const { response, pending } = startPending();
        const next = applyPullBatchToCache(synthesized(cache), { next_cursor: 30, has_more: false,
            inventory_items: [row('result', 'iron_sword', 30, true), row('next-result', 'steel_blade', 30)],
        });
        seed(next); const before = get().equipment;
        response.resolve(result); expect(await pending).toBeNull(); expect(apply()).toBeNull(); expect(get().equipment).toEqual(before);
        expect(get().equipment.map((item) => item.id).sort()).toEqual(['kept', 'next-result']); expect(get().character.totalXp).toBe(200);
    });
    it('素材も結果も無い場合は過去の結果を推測で追加せず、通常のpullへ任せる', () => {
        seed(initialCache()); const kept = get().equipment.filter((item) => item.id === 'kept');
        if (get === useGameStore.getState) useGameStore.setState({ equipment: kept });
        else useMobileGameStore.setState({ equipment: kept });
        expect(apply()).toBeNull(); expect(get().equipment).toEqual(kept);
    });
    it('素材が一部だけ残る場合も確定応答の適用と無関係な装備を維持する', () => {
        const cache = applyPullBatchToCache(initialCache(), { next_cursor: 15, has_more: false,
            inventory_items: ids.slice(1).map((id) => row(id, 'wooden_sword', 15, true)),
        });
        seed(cache); expect(apply()?.id).toBe('result');
        expect(get().equipment.map((item) => item.id).sort()).toEqual(['kept', 'result']);
    });
    it('未知のテンプレートでも素材は消費し、無関係な装備とXPを維持する', () => {
        seed(initialCache()); expect(apply('unknown-template')).toBeNull();
        expect(get().equipment.map((item) => item.id)).toEqual(['kept']); expect(get().character.totalXp).toBe(200);
    });
});
