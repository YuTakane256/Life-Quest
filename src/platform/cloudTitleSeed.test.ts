import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { applyCloudCacheToWebStores } from './cloudSync';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from './completionRewards';
import { useGameStore } from '../stores/useGameStore';
import { useTitleStore } from '../stores/useTitleStore';
import { enqueueCloudOperation as webEnqueue } from './cloudOutbox';
import { applyCloudCacheToMobileStores } from '../../apps/mobile/src/platform/cloudSeed';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';
import { useMobileTitleStore } from '../../apps/mobile/src/stores/useMobileTitleStore';
import { enqueueCloudOperation as mobileEnqueue } from '../../apps/mobile/src/platform/cloudOutbox';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('./cloudOutbox', async (original) => ({ ...await original<typeof import('./cloudOutbox')>(), enqueueCloudOperation: vi.fn(async () => true) }));
vi.mock('../../apps/mobile/src/platform/cloudOutbox', async (original) => ({ ...await original<typeof import('../../apps/mobile/src/platform/cloudOutbox')>(), enqueueCloudOperation: vi.fn(async () => true) }));

const initial = useGameStore.getInitialState();
const platforms = [
    { name: 'Web', seed: applyCloudCacheToWebStores, game: useGameStore, title: useTitleStore },
    { name: 'Mobile', seed: applyCloudCacheToMobileStores, game: useMobileGameStore, title: useMobileTitleStore },
];
function profile(activeTitle: unknown, version = 2, userId = 'a') {
    return applyPullBatchToCache(createEmptyCloudCache(), { next_cursor: version, has_more: false,
        profiles: [{ user_id: userId, active_title: activeTitle, version }],
        characters: [{ user_id: userId, total_xp: 0, version: 1 }],
    });
}
beforeEach(async () => {
    await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); await notifyLogin('a'); localStorage.clear();
    setGameRewardAuthorityState('authenticated');
    withoutCompletionRewardPersistence(() => useGameStore.setState({ ...initial, character: { ...initial.character, totalXp: 999 } }));
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true,
        character: { ...createInitialGameStateSnapshot().character, totalXp: 999 } });
    await useMobileTitleStore.persist.rehydrate();
    useTitleStore.setState({ activeTitle: '以前の称号' }); useMobileTitleStore.setState({ activeTitle: '以前の称号' });
    vi.mocked(webEnqueue).mockClear(); vi.mocked(mobileEnqueue).mockClear();
});
afterEach(async () => { vi.restoreAllMocks(); await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); setGameRewardAuthorityState('anonymous'); localStorage.clear(); });

describe.each(platforms)('$name: 称号の独立受信', ({ seed, game, title }) => {
    it('プロフィールだけの変更で称号を反映し、未変更のゲーム初期値や送信へ波及しない', () => {
        const before = game.getState();
        expect(seed(profile('  努力の人  '))).toBe(true);
        expect(title.getState().activeTitle).toBe('努力の人'); expect(game.getState()).toBe(before);
        expect(webEnqueue).not.toHaveBeenCalled(); expect(mobileEnqueue).not.toHaveBeenCalled();
    });
    it('明示的なnullは解除し、同じ受信の反復でも再送しない', () => {
        const cache = profile(null); seed(cache); seed(cache);
        expect(title.getState().activeTitle).toBeNull(); expect(game.getState().character.totalXp).toBe(999);
        expect(webEnqueue).not.toHaveBeenCalled(); expect(mobileEnqueue).not.toHaveBeenCalled();
    });
    it('新しい称号へ更新後、古い版の受信で巻き戻さない', () => {
        let cache = profile('古い称号'); seed(cache);
        cache = applyPullBatchToCache(cache, { next_cursor: 3, has_more: false, profiles: [{ user_id: 'a', active_title: '新しい称号', version: 3 }] }); seed(cache);
        cache = applyPullBatchToCache(cache, { next_cursor: 3, has_more: false, profiles: [{ user_id: 'a', active_title: '古い称号', version: 2 }] }); seed(cache);
        expect(title.getState().activeTitle).toBe('新しい称号');
    });
    it.each(['初期プロフィール', '欠落フィールド', '不正な型', '別所有者', '削除済み'])('%sを称号の解除として扱わない', (kind) => {
        const cache = profile(null, kind === '初期プロフィール' ? 1 : 2, kind === '別所有者' ? 'b' : 'a');
        if (kind === '欠落フィールド') delete cache.profiles.a.active_title;
        if (kind === '不正な型') cache.profiles.a.active_title = 123;
        if (kind === '削除済み') cache.profiles.a.deleted_at = '2026-11-06T00:00:00Z';
        seed(cache); expect(title.getState().activeTitle).toBe('以前の称号');
    });
    it('プロフィールがないゲーム更新で、現在の称号を消さない', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), { next_cursor: 3, has_more: false,
            characters: [{ user_id: 'a', total_xp: 500, version: 3 }],
        });
        seed(cache); expect(game.getState().character.totalXp).toBe(500);
        expect(title.getState().activeTitle).toBe('以前の称号');
    });
    it('ゲーム反映中にAからBへ切り替わった場合、Aの称号を後から適用しない', async () => {
        let changed: Promise<void> | undefined;
        const unsubscribe = game.subscribe((state) => {
            if (!changed && state.character.totalXp === 500) { changed = notifyLogin('b'); title.setState({ activeTitle: 'Bの称号' }); }
        });
        try {
            const cache = applyPullBatchToCache(profile('Aの称号'), { next_cursor: 3, has_more: false,
                characters: [{ user_id: 'a', total_xp: 500, version: 3 }],
            });
            seed(cache); await changed; expect(title.getState().activeTitle).toBe('Bの称号');
        } finally { unsubscribe(); }
    });
});

it('Mobileの保存読込中は称号を上書きせず、読込後の再反映で最新値へ進む', () => {
    const hydrated = vi.spyOn(useMobileTitleStore.persist, 'hasHydrated').mockReturnValue(false);
    const cache = profile('クラウドの称号');
    expect(applyCloudCacheToMobileStores(cache)).toBe(false);
    expect(useMobileTitleStore.getState().activeTitle).toBe('以前の称号');
    hydrated.mockReturnValue(true);
    expect(applyCloudCacheToMobileStores(cache)).toBe(true);
    expect(useMobileTitleStore.getState().activeTitle).toBe('クラウドの称号');
});
