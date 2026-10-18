import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createEquipmentFromTemplate, type Equipment } from '@life-quest/core/equipment';
import { EQUIPMENT_POOL } from '@life-quest/core/rewards';
import { useGameStore } from '../../stores/useGameStore';
import { useMobileGameStore } from '../../../apps/mobile/src/stores/useMobileGameStore';
import { InventorySection } from './InventorySection';

// Runtime load keeps Native's static-image declarations out of the Web TS program.
const nativeScreenModule = '../../../apps/mobile/src/screens/CharacterScreen';
const { default: CharacterScreen } = await import(nativeScreenModule);

const mocks = vi.hoisted(() => ({ alert: vi.fn(), synthesize: vi.fn(), retry: vi.fn(), enqueue: vi.fn(async () => true),
    hasError: false, blur: () => {}, focus: () => {}, saleConfirm: () => {} }));
vi.mock('../../platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isWebCloudOutboxActive: () => false }));
vi.mock('../../../apps/mobile/src/platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isCloudOutboxActive: () => false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('../../hooks/useCloudItemSynthesis', () => ({ useCloudItemSynthesis: () => ({
    synthesize: mocks.synthesize, retry: mocks.retry, isSynthesizing: false, hasError: mocks.hasError,
}) }));
vi.mock('../../../apps/mobile/src/hooks/useCloudItemSynthesis', () => ({ useCloudItemSynthesis: () => ({
    synthesize: mocks.synthesize, retry: mocks.retry, isSynthesizing: false, hasError: mocks.hasError,
}) }));
vi.mock('../../../apps/mobile/src/hooks/useCloudChestOpen', () => ({ useCloudChestOpen: () => ({ openChest: vi.fn(), retry: vi.fn() }) }));
vi.mock('../../../apps/mobile/src/components/CharacterOverview', () => ({ CharacterOverview: () => null }));
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
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children?: ReactNode }) => createElement('div', {}, children) }));
vi.mock('expo-router', () => ({ useFocusEffect: (setup: () => (() => void) | undefined) => {
    useEffect(() => {
        let cleanup = setup();
        mocks.blur = () => { cleanup?.(); cleanup = undefined; };
        mocks.focus = () => { cleanup = setup(); };
        return () => cleanup?.();
    }, [setup]);
} }));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string };
    const box = ({ children }: Props) => createElement('div', {}, children);
    return { Alert: { alert: mocks.alert }, View: box, ScrollView: box, Text: ({ children }: Props) => createElement('span', {}, children),
        Image: () => null, StyleSheet: { create: <T,>(value: T) => value },
        Pressable: ({ children, onPress, disabled, accessibilityLabel }: Props) => createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
        FlatList: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent }: {
            data: Equipment[]; renderItem: (item: { item: Equipment }) => ReactNode; ListHeaderComponent: ReactNode; ListEmptyComponent: ReactNode;
        }) => createElement('div', {}, ListHeaderComponent, data.length ? data.map((item) => createElement('div', { key: item.id }, renderItem({ item }))) : ListEmptyComponent),
    };
});

let host: HTMLDivElement; let root: Root | null;
const items = () => [0, 1, 2].map((index) => createEquipmentFromTemplate(`item-${index}`, EQUIPMENT_POOL.find((item) => item.id === 'wooden_sword')!));
const result = () => createEquipmentFromTemplate('result', EQUIPMENT_POOL.find((item) => item.id === 'iron_sword')!);
const webAddXp = useGameStore.getState().addXp;
const nativeAddXp = useMobileGameStore.getState().addXp;
function button(name: string) {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="button"],button')).find((element) => element.getAttribute('aria-label') === name || element.textContent?.trim() === name)!;
}
function click(element: HTMLElement) { expect(element).toBeTruthy(); act(() => element.click()); }
function unmount() { if (root) act(() => { root!.unmount(); root = null; }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks(); localStorage.clear(); mocks.hasError = false;
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
        platform === 'web' ? createElement(InventorySection) : createElement(CharacterScreen)))));
    const requestSale = () => {
        if (platform === 'web') {
            if (!button('木の剣を売却して+5XP獲得')) click(button('売却'));
            click(button('木の剣を売却して+5XP獲得'));
            return mocks.saleConfirm;
        }
        click(button('木の剣を売却する'));
        return mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === '売却する').onPress as () => void;
    };
    const selectSynthesis = () => {
        if (platform === 'web') click(button('合成'));
        const label = platform === 'web' ? '木の剣を合成対象に選択' : '木の剣を合成素材に選択する';
        const choices = Array.from(host.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`));
        for (const choice of choices) click(choice);
    };
    const confirmSynthesis = () => {
        click(button(platform === 'web' ? '合成する' : '選択した3個の装備を合成する'));
        if (platform === 'native') act(() => mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === '合成する').onPress());
    };
    describe(`${platform} inventory interaction ownership`, () => {
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
            if (platform === 'web') click(button('合成'));
            const label = platform === 'web' ? '木の剣を合成対象に選択' : '木の剣を合成素材に選択する';
            const oldChoices = Array.from(host.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`));
            await act(async () => { await notifyLogin('b'); for (const choice of oldChoices) choice.click(); });
            if (platform === 'web') { click(button('合成')); expect(button('合成する')).toBeUndefined(); }
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
    function mount() { act(() => root!.render(createElement(StrictMode, {}, createElement(CharacterScreen)))); }
    function pendingSynthesis() {
        for (const button of Array.from(host.querySelectorAll<HTMLElement>('[aria-label="木の剣を合成素材に選択する"]'))) click(button);
        click(button('選択した3個の装備を合成する'));
        return mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === '合成する').onPress as () => void;
    }
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
        mount(); click(button('木の剣を売却する'));
        const confirm = mocks.alert.mock.calls.at(-1)![2].find((action: { text: string }) => action.text === '売却する').onPress;
        act(() => { mocks.blur(); mocks.focus(); confirm(); });
        expect(mocks.enqueue).not.toHaveBeenCalled();
    });
});
