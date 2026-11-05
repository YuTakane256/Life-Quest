import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks, subscribeAuthSessionScope } from '@life-quest/core/authLifecycle';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { registerWebAuthStoreHooks, resetCloudSessionSeeded as resetWeb } from '../platform/authStores';
import { registerMobileAuthStoreHooks, resetCloudSessionSeeded as resetMobile } from '../../apps/mobile/src/platform/authStores';
import { useGameStore } from '../stores/useGameStore';
import { useMobileGameStore } from '../../apps/mobile/src/stores/useMobileGameStore';
import { flushCompletionRewardWrites, withoutCompletionRewardPersistence } from '../platform/completionRewards';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../../apps/mobile/src/stores/useMobileLoginBonusStore', () => ({
    beginMobileLoginBonusCloudSession: vi.fn(), clearMobileLoginBonusCloudSession: vi.fn(),
}));
const initialWeb = useGameStore.getInitialState();
const adapters = [
    { name: 'Web', register: registerWebAuthStoreHooks,
        start: () => useGameStore.getState().startBattle(1),
        touch: () => useGameStore.setState((s) => ({ gachaCount: s.gachaCount + 1 })),
        identity: () => useGameStore.getState().battle.playerSnapshot,
        ongoing: () => useGameStore.getState().battle.status === 'fighting',
        finish: () => useGameStore.setState((s) => ({ battle: { ...s.battle, status: 'victory' } })),
        saved: () => { const s = useGameStore.getState(); return { character: s.character, equipment: s.equipment,
            chests: s.chestQueue, ledger: s.completionRewardKeys, gachaCount: s.gachaCount, maxClearedStage: s.battle.maxClearedStage }; },
    },
    { name: 'Mobile', register: registerMobileAuthStoreHooks,
        start: () => useMobileGameStore.getState().startBattle(1),
        touch: () => useMobileGameStore.setState((s) => ({ gachaCount: s.gachaCount + 1 })),
        identity: () => useMobileGameStore.getState().activeBattle?.actors,
        ongoing: () => useMobileGameStore.getState().activeBattle?.state.outcome === 'ongoing',
        finish: () => useMobileGameStore.setState((s) => ({ activeBattle: { ...s.activeBattle!, state: { ...s.activeBattle!.state, outcome: 'victory' } } })),
        saved: () => { const s = useMobileGameStore.getState(); return { character: s.character, equipment: s.equipment,
            chests: s.chestQueue, ledger: s.rewardLedger, gachaCount: s.gachaCount, maxClearedStage: s.battleProgress.maxClearedStage }; },
    },
];
let unregister: (() => void) | undefined;
beforeEach(async () => {
    await flushCompletionRewardWrites(); resetAuthLifecycleHooks(); resetWeb(); resetMobile(); localStorage.clear();
    setGameRewardAuthorityState('anonymous');
    const saved = { ...createInitialGameStateSnapshot(), gachaCount: 7,
        chestQueue: [{ id: 'kept', label: 'Kept', chestType: 'wood' as const, opened: false, equipment: null }],
        rewardLedger: { rewardedTaskIds: ['kept-task'], rewardedSubtaskIds: [], habitBonusDates: [] } };
    withoutCompletionRewardPersistence(() => useGameStore.setState({ ...initialWeb, character: saved.character, equipment: saved.equipment,
        chestQueue: saved.chestQueue, gachaCount: saved.gachaCount, completionRewardKeys: ['task:kept-task'],
        battle: { ...initialWeb.battle, battleUnlocked: true } }));
    useMobileGameStore.setState({ ...saved, hasHydrated: true, activeBattle: null,
        battleProgress: { battleUnlocked: true, currentStage: 1, maxClearedStage: 0 } });
});
afterEach(async () => { unregister?.(); unregister = undefined; resetAuthLifecycleHooks(); await flushCompletionRewardWrites(); localStorage.clear(); });

describe.each(adapters)('$name battle auth boundary without a mounted map', (platform) => {
    it.each(['initial-login', 'switch', 'logout', 'logout-login'])('retires the old ongoing runtime on %s before async hooks and keeps saved data', async (transition) => {
        unregister = platform.register();
        if (transition !== 'initial-login') await notifyLogin('a');
        platform.start(); expect(platform.ongoing()).toBe(true); const saved = platform.saved();
        const pending = transition.startsWith('logout') ? notifyLogout() : notifyLogin('b');
        expect(platform.ongoing()).toBe(false); // Synchronous scope boundary, no mounted timer needed.
        await pending; if (transition === 'logout-login') await notifyLogin('a');
        expect(platform.ongoing()).toBe(false); expect(platform.saved()).toEqual(saved);
        platform.start(); expect(platform.ongoing()).toBe(true);
    });
    it('keeps the same-owner fight and its immutable snapshot', async () => {
        unregister = platform.register(); await notifyLogin('a'); platform.start(); const identity = platform.identity();
        await notifyLogin('a'); expect(platform.ongoing()).toBe(true); expect(platform.identity()).toBe(identity);
    });
    it('keeps completed anonymous results and their saved progress', async () => {
        unregister = platform.register(); platform.start(); platform.finish(); const identity = platform.identity(); const saved = platform.saved();
        await notifyLogin('a'); expect(platform.identity()).toBe(identity); expect(platform.saved()).toEqual(saved);
    });
    it('keeps a new fight created by an earlier scope listener in the new session', async () => {
        const unsubscribe = subscribeAuthSessionScope(() => platform.start());
        try {
            unregister = platform.register(); platform.start(); const old = platform.identity();
            await notifyLogin('b'); expect(platform.ongoing()).toBe(true); expect(platform.identity()).not.toBe(old);
        } finally { unsubscribe(); }
    });
    it('does not adopt an old fight when an earlier scope listener only updates other state', async () => {
        const unsubscribe = subscribeAuthSessionScope(() => platform.touch());
        try {
            unregister = platform.register(); platform.start();
            await notifyLogin('b'); expect(platform.identity()).toBeFalsy(); expect(platform.ongoing()).toBe(false);
        } finally { unsubscribe(); }
    });
    it('releases both subscriptions on unregister', async () => {
        unregister = platform.register(); platform.start(); unregister(); unregister = undefined;
        const identity = platform.identity(); await notifyLogin('a'); expect(platform.identity()).toBe(identity); expect(platform.ongoing()).toBe(true);
    });
});
