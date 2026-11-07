import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { applyPullBatchToCache, createEmptyCloudCache } from '@life-quest/core/cloudCache';
import { applyCloudCacheToMobileStores } from '../platform/cloudSeed';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import type { ChestReward } from '@life-quest/core/rewards';
import RootLayout from '../../app/_layout';
import CharacterScreen from './CharacterScreen';
import { useMobileGameStore } from '../stores/useMobileGameStore';

const mocks = vi.hoisted(() => ({ route: 'character', auth: vi.fn(), open: vi.fn(), sync: vi.fn(), push: vi.fn() }));
vi.mock('../platform/auth', () => ({ getGameAuthState: mocks.auth,
    startAuthSessionListener: () => () => {}, startMobileAuthLinkListener: () => () => {} }));
vi.mock('../platform/battleCloud', () => ({ openCloudChest: mocks.open }));
const nativeDisk = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async (key: string) => nativeDisk.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { nativeDisk.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { nativeDisk.delete(key); }),
} }));
vi.mock('../stores/useMobileLoginBonusStore', () => ({ beginMobileLoginBonusCloudSession: vi.fn(), clearMobileLoginBonusCloudSession: vi.fn() }));
vi.mock('../platform/cloudMigration', () => ({ registerMobileCloudMigrationHooks: () => () => {} }));
vi.mock('../platform/pendingCompletionFlush', () => ({ registerPendingCompletionFlush: () => () => {} }));
vi.mock('../platform/notifications', () => ({ registerNotificationChecks: () => () => {} }));
vi.mock('../platform/loginBonusCheck', () => ({ registerLoginBonusCheck: () => () => {} }));
vi.mock('../platform/cloudSync', () => ({ registerMobileCloudSyncHooks: () => () => {}, syncMobileNow: mocks.sync }));
vi.mock('../platform/cloudOutbox', () => ({ registerMobileOutboxHooks: () => () => {} }));
vi.mock('../platform/canonicalSync', async (importOriginal) => ({
    ...await importOriginal<typeof import('../platform/canonicalSync')>(),
    startMobileCanonicalSync: () => ({ stop() {} }),
}));
vi.mock('../stores/rewardSync', () => ({ startRewardSync: () => () => {} }));
vi.mock('../stores/statsLogSeed', () => ({ startStatsLogSeed: () => () => {} }));
vi.mock('../components/LoginBonusOverlay', () => ({ LoginBonusOverlay: () => null }));
vi.mock('../components/CloudSessionRecoveryGate', () => ({ CloudSessionRecoveryGate: () => null }));
vi.mock('../components/InventoryOperationsProvider', () => ({ InventoryOperationsProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/BattleStartProvider', () => ({ BattleStartProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/BattleResultProvider', () => ({ BattleResultProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('../components/InventorySection', () => ({ InventorySection: () => null }));
vi.mock('../components/CharacterProfileEditor', () => ({ CharacterProfileEditor: () => null }));
vi.mock('../components/CharacterLevelUpNotice', () => ({ CharacterLevelUpNotice: () => null }));
vi.mock('../components/ChestAcquisitionHistory', () => ({ ChestAcquisitionHistory: () => null }));
vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('expo-router', () => ({
    Stack: Object.assign(() => mocks.route === 'character' ? createElement(CharacterScreen) : createElement('div', {}, `${mocks.route}-route`), { Screen: () => null }),
    useRouter: () => ({ push: mocks.push }),
    useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
}));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; accessibilityLabel?: string; onPress?: () => void; disabled?: boolean; visible?: boolean };
    const box = ({ children }: Props) => createElement('div', {}, children);
    const animation = () => ({ start() {}, stop() {} });
    class Value { setValue() {} interpolate() { return '0deg'; } }
    return { View: box, ScrollView: box, Text: ({ children }: Props) => createElement('span', {}, children), Image: () => null,
        Pressable: ({ children, accessibilityLabel, onPress, disabled }: Props) => createElement('button', { 'aria-label': accessibilityLabel, onClick: onPress, disabled }, children),
        Modal: ({ children, visible }: Props) => visible ? createElement('div', { role: 'dialog' }, children) : null,
        StyleSheet: { create: <T,>(value: T) => value, absoluteFill: {} }, Keyboard: { dismiss() {} },
        useWindowDimensions: () => ({ width: 402, height: 874, fontScale: 1 }),
        Animated: { Value, View: box, Image: () => null, timing: animation, spring: animation, loop: animation, sequence: animation, parallel: animation },
    };
});
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => createElement('div', {}, children) }));
vi.mock('lucide-react-native', () => ({ Edit2: () => null, Gem: () => null, Milestone: () => null, Package: () => null, Shield: () => null, Sparkles: () => null, Sword: () => null }));
vi.mock('../theme/usePalette', async () => {
    const { LIGHT_THEME } = await import('@life-quest/core/designTokens');
    return { usePalette: () => ({ palette: LIGHT_THEME, resolvedTheme: 'light' }) };
});

const chests = (): ChestReward[] => [1, 2].map((n) => ({ id: `chest-${n}`, chestType: 'wood', label: `試験の木箱${n}`, equipment: null, opened: false, origin: 'cloud' }));
const result = (itemId = 'item') => ({ itemId, templateId: 'wooden_sword', starterCharacter: false });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
let root: Root; let host: HTMLDivElement; let mounted: boolean;
const openLabel = (n = 1) => `試験の木箱${n}を開封する`;
const retryLabel = '宝箱開封を再送する';
function button(label: string) { return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`); }
async function click(label: string) { const target = button(label); expect(target).not.toBeNull(); await act(async () => target!.click()); }
async function render(route = 'character') { mocks.route = route; mounted = true; await act(async () => root.render(createElement(StrictMode, {}, createElement(RootLayout)))); }
function resetGame() { useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, activeBattle: null,
    chestQueue: chests(), equipment: [], pendingChestReveal: null, lastLevelUp: null }); }
beforeEach(async () => {
    nativeDisk.clear(); resetAuthLifecycleHooks(); await notifyLogin('a'); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
    mocks.open.mockReset(); mocks.open.mockResolvedValue(result()); mocks.auth.mockReset(); mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'a' });
    resetGame(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = false;
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); host.remove(); resetAuthLifecycleHooks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Mobile宝箱：実Root・キャラUI・ストアと画面再作成（navigator/通信はスタブ）', () => {
    it('失敗後の画面再作成でも同じ宝箱/キーと再送案内を保持し、明示再送で一度開封する', async () => {
        mocks.open.mockRejectedValueOnce(new TypeError('response lost'));
        await render(); await click(openLabel()); expect(button(retryLabel)).not.toBeNull();
        await render('inventory'); await render('tasks'); await render();
        expect(button(retryLabel)).not.toBeNull(); expect(mocks.open).toHaveBeenCalledTimes(1);
        await click(retryLabel); expect(mocks.open).toHaveBeenCalledTimes(2);
        expect(mocks.open.mock.calls.map(([id]) => id)).toEqual(['chest-1', 'chest-1']);
        expect(mocks.open.mock.calls[0][1]).toBe(mocks.open.mock.calls[1][1]);
        expect(useMobileGameStore.getState().equipment.map((item) => item.id)).toEqual(['item']);
        expect(useMobileGameStore.getState().chestQueue.filter((chest) => chest.opened).map((chest) => chest.id)).toEqual(['chest-1']);
        expect(useMobileGameStore.getState().pendingChestReveal?.chestId).toBe('chest-1'); expect(button(retryLabel)).toBeNull();
        expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    });
    it.each([false, true])('保存から起動し直して同じ宝箱を再送する（確定済み: %s）', async (committed) => {
        mocks.open.mockRejectedValueOnce(new TypeError('response lost'));
        await render();
        await click(openLabel());
        await act(async () => root.unmount());
        mounted = false;
        const raw = nativeDisk.get('quest-board-game')!;
        expect(JSON.parse(raw).state.chestQueue[0]).toMatchObject({ id: 'chest-1', opened: false });
        useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: false, pendingChestReveal: null });
        nativeDisk.set('quest-board-game', raw);
        await useMobileGameStore.persist.rehydrate();
        root = createRoot(host);
        await render();
        expect(mocks.open).toHaveBeenCalledTimes(1);
        expect(button(retryLabel)).toBeNull();
        if (committed) {
            mocks.open.mockResolvedValueOnce({ ...result('sold'), requiresCanonicalSync: true });
            mocks.sync.mockImplementationOnce(async () => {
                applyCloudCacheToMobileStores(applyPullBatchToCache(createEmptyCloudCache(), {
                    next_cursor: 10, has_more: false,
                    characters: [{ user_id: 'a', total_xp: 0, version: 10 }],
                    chests: [{ id: 'chest-1', user_id: 'a', opened: true, opened_item_id: 'sold', chest_type: 'wood', label: '試験の木箱1', version: 9 }],
                    inventory_items: [{ id: 'sold', user_id: 'a', template_id: 'wooden_sword', version: 10, deleted_at: '2026-11-07' }],
                }));
            });
        }
        await click(openLabel());
        expect(mocks.open).toHaveBeenCalledTimes(2);
        expect(mocks.open.mock.calls[1].slice(0, 2)).toEqual(mocks.open.mock.calls[0].slice(0, 2));
        expect(useMobileGameStore.getState().chestQueue.find((item) => item.id === 'chest-1')?.opened).toBe(true);
        expect(useMobileGameStore.getState().equipment.map((item) => item.id)).toEqual(committed ? [] : ['item']);
        expect(useMobileGameStore.getState().pendingChestReveal?.chestId ?? null).toBe(committed ? null : 'chest-1');
        expect(mocks.sync).toHaveBeenCalledTimes(committed ? 1 : 0);
    });
    it('送信中の再作成で全宝箱を無効化し、離脱中の本人結果を一度反映して共通演出を表示する', async () => {
        const pending = deferred<ReturnType<typeof result>>(); mocks.open.mockReturnValueOnce(pending.promise);
        await render(); await click(openLabel()); await render('tasks'); await render();
        expect(button(openLabel())?.disabled).toBe(true); expect(button(openLabel(2))?.disabled).toBe(true);
        await click(openLabel()); await click(openLabel(2)); expect(mocks.open).toHaveBeenCalledTimes(1);
        await render('tasks'); await act(async () => pending.resolve(result()));
        expect(mocks.route).toBe('tasks'); expect(mocks.push).not.toHaveBeenCalled();
        expect(useMobileGameStore.getState().equipment.map((item) => item.id)).toEqual(['item']);
        expect(useMobileGameStore.getState().pendingChestReveal?.chestId).toBe('chest-1');
        expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(host.textContent).toContain('タップして開ける');
        await render(); expect(button(openLabel(2))?.disabled).toBe(false);
    });
    it('同一所有者の重複通知でも再送情報を保持する', async () => {
        mocks.open.mockRejectedValueOnce(new TypeError('response lost'));
        await render(); await click(openLabel()); await render('tasks'); await act(async () => notifyLogin('a')); await render();
        expect(button(retryLabel)).not.toBeNull(); await click(retryLabel);
        expect(mocks.open.mock.calls[0][1]).toBe(mocks.open.mock.calls[1][1]);
    });
    it.each(['別ユーザー', 'ログアウト後に同じユーザー'] as const)('%sへの切替で旧再送情報を破棄する', async (transition) => {
        mocks.open.mockRejectedValueOnce(new TypeError('response lost'));
        await render(); await click(openLabel()); await render('tasks');
        const userId = transition === '別ユーザー' ? 'b' : 'a';
        await act(async () => { if (userId === 'a') await notifyLogout(); mocks.auth.mockResolvedValue({ kind: 'authenticated', userId }); await notifyLogin(userId); resetGame(); });
        await render(); expect(button(retryLabel)).toBeNull(); await click(openLabel());
        const sameKey = mocks.open.mock.calls[0][1] === mocks.open.mock.calls[1][1];
        expect(sameKey).toBe(userId === 'a');
        expect(mocks.open.mock.calls[1][2].expectedUserId).toBe(userId);
    });
    it('遅いAの応答/finallyがBの装備・演出・処理中表示を変更しない', async () => {
        const old = deferred<ReturnType<typeof result>>(); const current = deferred<ReturnType<typeof result>>();
        mocks.open.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        await render(); await click(openLabel()); await render('tasks');
        await act(async () => { mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b'); resetGame(); });
        await render(); await click(openLabel()); await act(async () => old.resolve(result('old-a')));
        expect(useMobileGameStore.getState().equipment).toEqual([]); expect(useMobileGameStore.getState().pendingChestReveal).toBeNull();
        expect(button(openLabel())?.disabled).toBe(true); expect(button(openLabel(2))?.disabled).toBe(true);
        await act(async () => current.resolve(result('new-b')));
        expect(useMobileGameStore.getState().equipment.map((item) => item.id)).toEqual(['new-b']);
    });
    it('アプリ全体をunmountした後は旧応答で装備や演出を追加しない', async () => {
        const pending = deferred<ReturnType<typeof result>>(); mocks.open.mockReturnValueOnce(pending.promise);
        await render(); await click(openLabel()); await act(async () => root.unmount()); mounted = false;
        await act(async () => pending.resolve(result()));
        expect(mocks.open.mock.calls[0][2].isActive()).toBe(false);
        expect(useMobileGameStore.getState().equipment).toEqual([]); expect(useMobileGameStore.getState().pendingChestReveal).toBeNull();
    });
});
