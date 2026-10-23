import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createEquipmentFromTemplate, type Equipment } from '@life-quest/core/equipment';
import { EQUIPMENT_POOL } from '@life-quest/core/rewards';
import { INVENTORY_SELECTION_CHANGED } from '@life-quest/core/inventory';
import { useGameStore } from '../../stores/useGameStore';
import { useMobileGameStore } from '../../../apps/mobile/src/stores/useMobileGameStore';
import { InventorySection } from './InventorySection';

// Runtime load keeps Native's static-image declarations out of the Web TS program.
const nativeScreenModule = '../../../apps/mobile/src/screens/InventoryScreen';
const { default: InventoryScreen } = await import(nativeScreenModule);
const characterScreenModule = '../../../apps/mobile/src/screens/CharacterScreen';
const { default: CharacterScreen } = await import(characterScreenModule);

const mocks = vi.hoisted(() => ({ alert: vi.fn(), synthesize: vi.fn(), retry: vi.fn(), enqueue: vi.fn(async () => true),
    hasError: false, blur: () => {}, focus: () => {}, saleConfirm: () => {}, push: vi.fn(), dismissTo: vi.fn(), actions: new Map<string, () => void>() }));
vi.mock('../../platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isWebCloudOutboxActive: () => false }));
vi.mock('../../../apps/mobile/src/platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isCloudOutboxActive: () => false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../../hooks/useCloudItemSynthesis', () => ({ useCloudItemSynthesis: () => ({
    synthesize: mocks.synthesize, retry: mocks.retry, isSynthesizing: false, hasError: mocks.hasError,
}) }));
vi.mock('../../../apps/mobile/src/hooks/useInventorySynthesis', () => ({ useInventorySynthesis: () => ({
    synthesize: mocks.synthesize, retry: mocks.retry, isSynthesizing: false, hasError: mocks.hasError,
}) }));
vi.mock('../../../apps/mobile/src/hooks/useCloudChestOpen', () => ({ useCloudChestOpen: () => ({ openChest: vi.fn(), retry: vi.fn() }) }));
vi.mock('../../../apps/mobile/src/components/CharacterOverview', () => ({ CharacterOverview: () => createElement('div', {}, 'プロフィールと成長') }));
vi.mock('../../../apps/mobile/src/theme/usePalette', async () => {
    const { DARK_THEME } = await import('@life-quest/core/designTokens');
    return { usePalette: () => ({ palette: DARK_THEME }) };
});
vi.mock('../ui/ConfirmDialog', async (original) => {
    const { ConfirmDialog } = await original<typeof import('../ui/ConfirmDialog')>();
    return { ConfirmDialog: (props: Parameters<typeof ConfirmDialog>[0]) => {
        if (props.open) mocks.saleConfirm = props.onConfirm;
        return createElement(ConfirmDialog, props);
    } };
});
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children, edges }: { children?: ReactNode; edges?: readonly string[] }) => createElement('div', { 'data-edges': edges?.join(',') ?? 'all' }, children) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push, dismissTo: mocks.dismissTo }), useFocusEffect: (setup: () => (() => void) | undefined) => {
    useEffect(() => {
        let cleanup = setup();
        mocks.blur = () => { cleanup?.(); cleanup = undefined; };
        mocks.focus = () => { cleanup = setup(); };
        return () => cleanup?.();
    }, [setup]);
} }));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string; accessibilityRole?: string; accessibilityState?: { checked?: boolean } };
    const box = ({ children }: Props) => createElement('div', {}, children);
    return { Alert: { alert: mocks.alert }, View: box, ScrollView: box, Text: ({ children }: Props) => createElement('span', {}, children),
        Image: () => null, StyleSheet: { create: <T,>(value: T) => value },
        Pressable: ({ children, onPress, disabled, accessibilityLabel, accessibilityRole, accessibilityState }: Props) => {
            if (accessibilityLabel && onPress) mocks.actions.set(accessibilityLabel, onPress);
            return createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel, role: accessibilityRole, 'aria-checked': accessibilityState?.checked }, children);
        },
        FlatList: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent, ListFooterComponent }: {
            data: Equipment[]; renderItem: (item: { item: Equipment }) => ReactNode; ListHeaderComponent: ReactNode; ListEmptyComponent: ReactNode; ListFooterComponent: ReactNode;
        }) => createElement('div', {}, ListHeaderComponent, data.length ? data.map((item) => createElement('div', { key: item.id }, renderItem({ item }))) : ListEmptyComponent, ListFooterComponent),
    };
});

let host: HTMLDivElement; let root: Root | null;
const items = () => [0, 1, 2].map((index) => createEquipmentFromTemplate(`item-${index}`, EQUIPMENT_POOL.find((item) => item.id === 'wooden_sword')!));
const result = () => createEquipmentFromTemplate('result', EQUIPMENT_POOL.find((item) => item.id === 'iron_sword')!);
const webAddXp = useGameStore.getState().addXp;
const nativeAddXp = useMobileGameStore.getState().addXp;
function button(name: string) {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="button"],[role="checkbox"],[role="radio"],button')).find((element) => element.getAttribute('aria-label') === name || element.textContent?.trim() === name)!;
}
function click(element: HTMLElement) { expect(element).toBeTruthy(); act(() => element.click()); }
function unmount() { if (root) act(() => { root!.unmount(); root = null; }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks(); mocks.actions.clear(); localStorage.clear(); mocks.hasError = false;
    mocks.synthesize.mockResolvedValue(null); mocks.retry.mockResolvedValue(null);
    useGameStore.setState({ equipment: items(), addXp: vi.fn() });
    useMobileGameStore.setState({ equipment: items(), hasHydrated: true, lastLevelUp: null, addXp: vi.fn() });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
    unmount(); host.remove(); resetAuthLifecycleHooks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
    useGameStore.setState({ addXp: webAddXp }); useMobileGameStore.setState({ addXp: nativeAddXp });
});

for (const platform of ['web', 'native'] as const) {
    const store = platform === 'web' ? useGameStore : useMobileGameStore;
    const setEquipment = (equipment: Equipment[]) => {
        if (platform === 'web') useGameStore.setState({ equipment }); else useMobileGameStore.setState({ equipment });
    };
    const mount = () => act(() => root!.render(createElement(StrictMode, {}, createElement(MemoryRouter, {},
        platform === 'web' ? createElement(InventorySection) : createElement(InventoryScreen)))));
    const requestSale = () => {
        if (platform === 'web') {
            if (!button('木の剣を売却して+5XP獲得')) click(button('売却'));
            click(button('木の剣を売却して+5XP獲得'));
            return mocks.saleConfirm;
        }
        if (!button('木の剣を売却する')) click(button('売却'));
        click(button('木の剣を売却する'));
        return mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === '売却する').onPress as () => void;
    };
    const selectSynthesis = () => {
        click(button('合成'));
        const label = platform === 'web' ? '木の剣を合成対象に選択' : '木の剣を合成素材に選択する';
        const choices = Array.from(host.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`));
        for (const choice of choices) click(choice);
    };
    const confirmSynthesis = () => {
        click(button(platform === 'web' ? '合成する' : '選択した3個の装備を合成する'));
        if (platform === 'native') act(() => mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === '合成する').onPress());
    };
    const changeFilter = (value: 'armor' | 'weapon' | 'all') => {
        if (platform === 'web') {
            const select = Array.from(host.querySelectorAll('label')).find((label) => label.querySelector('span')?.textContent === '種類')!.querySelector('select')!;
            select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
        } else button(`種類を${value === 'armor' ? '防具' : value === 'weapon' ? '武器' : 'すべて'}にする`).click();
    };
    const selectedCount = () => host.querySelectorAll(`[aria-label="${platform === 'web' ? '木の剣を合成対象に選択中' : '木の剣を合成素材に選択解除する'}"]`).length;
    describe(`${platform} inventory selection and filters`, () => {
        it('shows only unequipped items and only the current mode actions', () => {
            setEquipment([...items(), { ...result(), id: 'equipped', name: '装備中の剣', equipped: true }]);
            mount(); expect(host.textContent).not.toContain('装備中の剣'); expect(button('木の剣を装備する')).toBeTruthy();
            expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
            click(button('売却')); expect(button('木の剣を装備する')).toBeUndefined(); expect(host.textContent).toContain('+5');
            click(button('合成')); expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(3);
            click(button('合成')); expect(button('木の剣を装備する')).toBeTruthy();
            expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
        });
        it('mode changes invalidate stale equip and selection actions before rerender', () => {
            mount(); const equip = button('木の剣を装備する');
            act(() => { button('合成').click(); equip.click(); }); expect(mocks.enqueue).not.toHaveBeenCalled();
            const choice = button(platform === 'web' ? '木の剣を合成対象に選択' : '木の剣を合成素材に選択する');
            act(() => { button('売却').click(); choice.click(); });
            click(button('合成')); expect(selectedCount()).toBe(0); expect(mocks.synthesize).not.toHaveBeenCalled();
        });
        it('mode changes reject pending sale confirmations', () => {
            mount(); const confirm = requestSale(); click(button('合成')); act(confirm);
            expect(store.getState().equipment).toHaveLength(3); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('equipping removes the item from inventory but preserves it in the store', () => {
            setEquipment([{ ...items()[0], name: '確認用の剣' }]); mount(); click(button('確認用の剣を装備する'));
            expect(button('確認用の剣を装備する')).toBeUndefined(); expect(host.textContent).toContain('未装備の装備がありません');
            expect(store.getState().equipment).toMatchObject([{ id: 'item-0', equipped: true }]);
        });
        it('rejects a repeated selection callback before rerender', () => {
            mount(); click(button('合成'));
            const choice = button(platform === 'web' ? '木の剣を合成対象に選択' : '木の剣を合成素材に選択する');
            act(() => { choice.click(); choice.click(); }); expect(selectedCount()).toBe(1);
        });
        it('limits selection to three of five materials', () => {
            const five = [...items(), ...items().slice(0, 2).map((item, index) => ({ ...item, id: `extra-${index}` }))];
            setEquipment(five); mount(); selectSynthesis(); expect(selectedCount()).toBe(3);
            confirmSynthesis(); expect(mocks.synthesize).toHaveBeenCalledExactlyOnceWith(['item-0', 'item-1', 'item-2']);
        });
        it.each(['changed', 'equipped', 'missing'] as const)('prunes a %s selected item and does not silently reselect a restored ID', (change) => {
            mount(); selectSynthesis();
            const next = items(); if (change === 'changed') next[0].attackBonus++; else if (change === 'equipped') next[0].equipped = true;
            act(() => setEquipment(change === 'missing' ? next.slice(1) : next));
            expect(selectedCount()).toBe(2); expect(host.textContent).toContain(INVENTORY_SELECTION_CHANGED);
            act(() => setEquipment(items())); expect(selectedCount()).toBe(2); expect(mocks.synthesize).not.toHaveBeenCalled();
        });
        it('preserves selection on equal pull / same user / unrelated loot', async () => {
            mount(); selectSynthesis(); await act(async () => { await notifyLogin('a'); setEquipment([...items(), { ...items()[0], id: 'loot' }]); });
            expect(selectedCount()).toBe(3); confirmSynthesis(); expect(mocks.synthesize).toHaveBeenCalledOnce();
        });
        it('changing a filter invalidates old selection and synthesis events before rerender', () => {
            mount(); selectSynthesis(); const old = button(platform === 'web' ? '合成する' : '選択した3個の装備を合成する');
            act(() => { changeFilter('armor'); old.click(); });
            expect(selectedCount()).toBe(0); expect(host.textContent).toContain('条件に合う装備がありません');
            expect(mocks.synthesize).not.toHaveBeenCalled(); expect(mocks.alert).not.toHaveBeenCalled();
            click(button('表示条件をリセット')); expect(host.textContent).not.toContain('条件に合う装備がありません'); expect(selectedCount()).toBe(0);
        });
        it('explicit clear invalidates an old synthesis control', () => {
            mount(); selectSynthesis(); const old = button(platform === 'web' ? '合成する' : '選択した3個の装備を合成する');
            act(() => { button('素材の選択を解除').click(); old.click(); }); expect(selectedCount()).toBe(0); expect(mocks.synthesize).not.toHaveBeenCalled();
        });
        it('deselecting one material invalidates an old synthesis control before rerender', () => {
            mount(); selectSynthesis(); const old = button(platform === 'web' ? '合成する' : '選択した3個の装備を合成する');
            const selected = button(platform === 'web' ? '木の剣を合成対象に選択中' : '木の剣を合成素材に選択解除する');
            act(() => { selected.click(); old.click(); }); expect(selectedCount()).toBe(2); expect(mocks.synthesize).not.toHaveBeenCalled(); expect(mocks.alert).not.toHaveBeenCalled();
        });
        it('late synthesis feedback does not clear a new material selection', async () => {
            const pending = deferred<Equipment | null>(); mocks.synthesize.mockReturnValue(pending.promise);
            setEquipment([...items(), { ...items()[0], id: 'extra', name: '次に使う装備' }]); mount(); selectSynthesis(); confirmSynthesis();
            if (platform === 'web') click(button('木の剣を合成対象に選択中'));
            click(button(platform === 'web' ? '次に使う装備を合成対象に選択' : '次に使う装備を合成素材に選択する'));
            await act(async () => { pending.resolve(result()); await pending.promise; });
            expect(button(platform === 'web' ? '次に使う装備を合成対象に選択中' : '次に使う装備を合成素材に選択解除する')).toBeTruthy();
        });
        it('auth switch resets filters and selection; same-user notification does not', async () => {
            mount(); act(() => changeFilter('weapon')); await act(async () => notifyLogin('a')); expect(button('表示条件をリセット')).toBeTruthy();
            await act(async () => notifyLogin('b')); expect(button('表示条件をリセット')).toBeUndefined();
        });
        if (platform === 'native') {
            it('mode changes invalidate pending synthesis and clear selected materials', () => {
                mount(); selectSynthesis(); click(button('選択した3個の装備を合成する'));
                const confirm = mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === '合成する').onPress;
                act(() => { button('売却').click(); confirm(); }); expect(mocks.synthesize).not.toHaveBeenCalled();
                click(button('合成')); expect(selectedCount()).toBe(0);
            });
            it('filter reset rejects pending native synthesis confirmation', () => {
                mount(); selectSynthesis(); click(button('選択した3個の装備を合成する'));
                const confirm = mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === '合成する').onPress;
                act(() => { changeFilter('armor'); confirm(); }); expect(mocks.synthesize).not.toHaveBeenCalled();
            });
            it('blur/refocus restores default filters with no selected materials', () => {
                mount(); act(() => changeFilter('weapon')); selectSynthesis();
                act(() => { mocks.blur?.(); mocks.focus?.(); }); expect(button('表示条件をリセット')).toBeUndefined(); expect(selectedCount()).toBe(0);
            });
        }
    });
    describe(`${platform} inventory interaction ownership`, () => {
        it('equips once through the existing store / outbox; no XP changes', () => {
            mount(); const equip = button('木の剣を装備する'); const before = { ...store.getState().character };
            act(() => { equip.click(); equip.click(); });
            expect(store.getState().equipment[0].equipped).toBe(true);
            expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith('set_equipped_items', { p_item_ids: ['item-0'] });
            expect(store.getState().character).toEqual(before);
        });
        it.each(['switch', 'changed', 'missing', 'equal'] as const)('equip validates rendered items: %s', async (change) => {
            mount(); const equip = button('木の剣を装備する');
            await act(async () => {
                if (change === 'switch') await notifyLogin('b');
                const next = items(); if (change === 'changed') next[0].attackBonus++;
                setEquipment(change === 'missing' ? [] : next); equip.click();
            });
            expect(mocks.enqueue).toHaveBeenCalledTimes(change === 'equal' ? 1 : 0);
        });
        if (platform === 'native') it('blur/refocus invalidates old equip controls', () => {
            mount(); const equip = button('木の剣を装備する');
            act(() => { mocks.blur?.(); mocks.focus?.(); equip.click(); }); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('通常確認は売却とenqueueを1度だけ実行する', () => {
            mount(); const confirm = requestSale(); act(confirm); act(confirm);
            expect(store.getState().equipment).toHaveLength(2); expect(mocks.enqueue).toHaveBeenCalledTimes(1);
            expect(store.getState().addXp).toHaveBeenCalledTimes(1);
        });
        it.each(['logout', 'switch', 'roundtrip', 'unmount'] as const)('%s後の旧確認で同IDの装備を売らない', async (transition) => {
            mount(); const confirm = requestSale();
            await act(async () => {
                if (transition === 'unmount') unmount();
                else if (transition === 'logout') await notifyLogout();
                else if (transition === 'switch') await notifyLogin('b');
                else { await notifyLogout(); await notifyLogin('a'); }
                setEquipment(items());
                confirm();
            });
            expect(store.getState().equipment).toHaveLength(3); expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it.each(['equipped', 'replaced', 'missing'] as const)('確認中に%sとなった装備は売らない', (change) => {
            mount(); const confirm = requestSale();
            act(() => {
                const current = items();
                if (change === 'equipped') current[0].equipped = true;
                if (change === 'replaced') current[0].name = '別の装備';
                setEquipment(change === 'missing' ? [] : current); confirm();
            });
            expect(mocks.enqueue).not.toHaveBeenCalled();
        });
        it('同一ユーザー通知/同値pullでは確認を維持する', async () => {
            mount(); const confirm = requestSale();
            await act(async () => { await notifyLogin('a'); setEquipment(items()); confirm(); });
            expect(mocks.enqueue).toHaveBeenCalledOnce();
        });
        it.each(['switch', 'unmount'] as const)('合成完了が%s後なら旧結果を表示しない', async (transition) => {
            const pending = deferred<Equipment | null>(); mocks.synthesize.mockReturnValue(pending.promise);
            mount(); selectSynthesis(); confirmSynthesis(); expect(mocks.synthesize).toHaveBeenCalledOnce();
            await act(async () => {
                if (transition === 'switch') await notifyLogin('b'); else unmount();
                pending.resolve(result()); await pending.promise;
            });
            expect(host.textContent).not.toContain(platform === 'web' ? 'を入手！' : 'が誕生！');
        });
        it('再送成功でも結果を表示する', async () => {
            mocks.hasError = true; mocks.retry.mockResolvedValue(result()); mount();
            await act(async () => { button(platform === 'web' ? '再送' : '装備合成を再送する').click(); });
            expect(host.textContent).toContain(platform === 'web' ? 'を入手！' : 'が誕生！');
        });
        it('再描画前の認証切替でも旧画面の合成を開始しない', async () => {
            mount(); selectSynthesis();
            const confirm = button(platform === 'web' ? '合成する' : '選択した3個の装備を合成する');
            await act(async () => { await notifyLogin('b'); confirm.click(); });
            expect(mocks.synthesize).not.toHaveBeenCalled(); expect(mocks.alert).not.toHaveBeenCalled();
        });
        it('再描画前の古い選択イベントを次のアカウントへ持ち越さない', async () => {
            mount();
            click(button('合成'));
            const label = platform === 'web' ? '木の剣を合成対象に選択' : '木の剣を合成素材に選択する';
            const oldChoices = Array.from(host.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`));
            await act(async () => { await notifyLogin('b'); for (const choice of oldChoices) choice.click(); });
            click(button('合成'));
            if (platform === 'web') expect(button('合成する')).toBeUndefined();
            else expect(button('選択した3個の装備を合成する').disabled).toBe(true);
        });
        it('通知は認証切替で破棄し、次のアカウントでは通常操作できる', async () => {
            mocks.hasError = true; mocks.retry.mockResolvedValue(result()); mount();
            await act(async () => button(platform === 'web' ? '再送' : '装備合成を再送する').click());
            await act(async () => notifyLogin('b'));
            expect(host.textContent).not.toContain(platform === 'web' ? 'を入手！' : 'が誕生！');
            const confirm = requestSale(); act(confirm); expect(mocks.enqueue).toHaveBeenCalledOnce();
            unmount(); expect(vi.getTimerCount()).toBe(0);
        });
    });
}

describe('Web feedback timer ownership', () => {
    function mount() { act(() => root!.render(createElement(MemoryRouter, {}, createElement(InventorySection)))); }
    function sell() { click(button('木の剣を売却して+5XP獲得')); click(button('売却する')); }
    it('前の売却タイマーが新しいXP通知を消さない', () => {
        mount(); click(button('売却')); sell();
        act(() => vi.advanceTimersByTime(1000)); sell();
        act(() => vi.advanceTimersByTime(500)); expect(host.textContent).toContain('+5 XP 獲得！');
        act(() => vi.advanceTimersByTime(1000)); expect(host.textContent).not.toContain('+5 XP 獲得！');
    });
    it('前の合成タイマーが新しい獲得通知を消さない', async () => {
        mocks.hasError = true; mocks.retry.mockResolvedValueOnce(result()).mockResolvedValueOnce({ ...result(), id: 'result-2', name: '次の装備' });
        mount(); await act(async () => button('再送').click());
        act(() => vi.advanceTimersByTime(1000)); await act(async () => button('再送').click());
        act(() => vi.advanceTimersByTime(2000)); expect(host.textContent).toContain('次の装備 を入手！');
        act(() => vi.advanceTimersByTime(1000)); expect(host.textContent).not.toContain('次の装備 を入手！');
    });
    it('同一Equipmentオブジェクトの再通知でも表示期間を分離する', async () => {
        mocks.hasError = true; mocks.retry.mockResolvedValue(result());
        mount(); await act(async () => button('再送').click());
        act(() => vi.advanceTimersByTime(1000)); await act(async () => button('再送').click());
        act(() => vi.advanceTimersByTime(2000)); expect(host.textContent).toContain('を入手！');
        act(() => vi.advanceTimersByTime(1000)); expect(host.textContent).not.toContain('を入手！');
    });
});

describe('Native alert/focus boundary', () => {
    function mount() { act(() => root!.render(createElement(StrictMode, {}, createElement(InventoryScreen)))); }
    function pendingSynthesis() {
        click(button('合成'));
        for (const button of Array.from(host.querySelectorAll<HTMLElement>('[aria-label="木の剣を合成素材に選択する"]'))) click(button);
        click(button('選択した3個の装備を合成する'));
        return mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === '合成する').onPress as () => void;
    }
    it('独立画面にはプロフィールを重ねず、下部safe areaと固定の戻る操作を持つ', () => {
        mount(); expect(host.textContent).not.toContain('プロフィールと成長');
        expect(host.querySelector('[data-edges="all"]')).toBeTruthy(); expect(button('キャラクター画面に戻る')).toBeTruthy();
    });
    it('直接開いた読込中でもキャラ画面へ戻れる', () => {
        useMobileGameStore.setState({ hasHydrated: false }); mount();
        expect(host.textContent).toContain('保存データを読み込み中'); click(button('キャラクター画面に戻る'));
        expect(mocks.dismissTo).toHaveBeenCalledExactlyOnceWith('/character'); expect(button('木の剣を売却する')).toBeUndefined();
    });
    it('所持品が0件でも戻る操作と空の案内を残す', () => {
        useMobileGameStore.setState({ equipment: [] }); mount();
        expect(host.textContent).toContain('未装備の装備がありません'); expect(button('売却')).toBeUndefined(); expect(button('合成')).toBeUndefined();
        click(button('キャラクター画面に戻る')); expect(mocks.dismissTo).toHaveBeenCalledExactlyOnceWith('/character');
    });
    it('戻る操作直後はblur前でも旧合成確認・連打・結果通知を拒否する', async () => {
        mount(); const confirm = pendingSynthesis(); const back = mocks.actions.get('キャラクター画面に戻る')!;
        act(() => { back(); back(); confirm(); });
        expect(mocks.dismissTo).toHaveBeenCalledExactlyOnceWith('/character'); expect(mocks.synthesize).not.toHaveBeenCalled();
    });
    it('戻る操作直後はblur前でも旧売却確認を拒否する', () => {
        mount(); click(button('売却')); click(button('木の剣を売却する'));
        const confirm = mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === '売却する').onPress;
        click(button('キャラクター画面に戻る')); act(confirm);
        expect(useMobileGameStore.getState().equipment).toHaveLength(3); expect(mocks.enqueue).not.toHaveBeenCalled();
    });
    it('戻る前に送信済みの合成結果は閉じた画面に通知せず、二重送信もしない', async () => {
        const pending = deferred<Equipment | null>(); mocks.synthesize.mockReturnValue(pending.promise);
        mount(); const confirm = pendingSynthesis(); act(confirm); click(button('キャラクター画面に戻る'));
        await act(async () => pending.resolve(result()));
        expect(mocks.synthesize).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain('合成で「');
    });
    it.each(['blur', 'switch', 'equipped', 'replaced'] as const)('確認を開いた後の%sでは合成を送信しない', async (change) => {
        mount(); const confirm = pendingSynthesis();
        await act(async () => {
            if (change === 'blur') { mocks.blur(); mocks.focus(); }
            if (change === 'switch') await notifyLogin('b');
            const current = items();
            if (change === 'equipped') current[0].equipped = true;
            if (change === 'replaced') current[0].name = '別の装備';
            useMobileGameStore.setState({ equipment: current }); confirm();
        });
        expect(mocks.synthesize).not.toHaveBeenCalled();
    });
    it('Alertを二度確定しても合成の起動は1度だけ', async () => {
        mount(); const confirm = pendingSynthesis(); await act(async () => { confirm(); confirm(); });
        expect(mocks.synthesize).toHaveBeenCalledOnce();
        expect(mocks.synthesize).toHaveBeenCalledWith(['item-0', 'item-1', 'item-2']);
    });
    it('キャンセルしたAlertの古い確定callbackでは合成しない', () => {
        mount(); const confirm = pendingSynthesis();
        act(() => { mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === 'キャンセル').onPress(); confirm(); });
        expect(mocks.synthesize).not.toHaveBeenCalled();
    });
    it('別タブへ移動して戻った後も、旧売却Alertは無効のまま', () => {
        mount(); click(button('売却')); click(button('木の剣を売却する'));
        const confirm = mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === '売却する').onPress;
        act(() => { mocks.blur(); mocks.focus(); confirm(); });
        expect(mocks.enqueue).not.toHaveBeenCalled();
    });
});

describe('Native character / inventory entry', () => {
    const mount = () => act(() => root!.render(createElement(StrictMode, {}, createElement(CharacterScreen))));
    it('キャラには成長・件数付き導線を残し、全装備行を描画しない', () => {
        mount(); expect(host.textContent).toContain('プロフィールと成長'); expect(host.textContent).toContain('インベントリを見る（3）');
        expect(button('木の剣を売却する')).toBeUndefined();
        const open = mocks.actions.get('インベントリを開く')!; act(() => { open(); open(); });
        expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/inventory');
        act(() => { mocks.blur(); mocks.focus(); }); click(button('インベントリを開く'));
        expect(mocks.push).toHaveBeenCalledTimes(2);
    });
    it.each(['switch', 'blur', 'hydrating'])('%s後の古い入口は画面移動しない', async (kind) => {
        mount(); const open = mocks.actions.get('インベントリを開く')!;
        await act(async () => {
            if (kind === 'switch') await notifyLogin('b');
            if (kind === 'blur') { mocks.blur(); mocks.focus(); }
            if (kind === 'hydrating') useMobileGameStore.setState({ hasHydrated: false });
            open();
        }); expect(mocks.push).not.toHaveBeenCalled();
    });
    it.each(['character', 'inventory'])('%sでも既存レベルアップ通知を表示・閉じる', (screen) => {
        useMobileGameStore.setState({ lastLevelUp: { fromLevel: 1, toLevel: 2, attackGain: 1, defenseGain: 1, hpGain: 5 } });
        act(() => root!.render(createElement(StrictMode, {}, screen === 'character' ? createElement(CharacterScreen) : createElement(InventoryScreen))));
        expect(host.textContent).toContain('レベルアップ！ Lv.1 → Lv.2'); click(button('レベルアップ通知を閉じる'));
        expect(useMobileGameStore.getState().lastLevelUp).toBeNull(); expect(host.textContent).not.toContain('レベルアップ！');
    });
});
