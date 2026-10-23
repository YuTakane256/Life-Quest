import { act, createElement, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEquipmentFromTemplate } from '@life-quest/core/equipment';
import { createInitialGameStateSnapshot } from '@life-quest/core/gameState';
import { EQUIPMENT_POOL, type ChestReward } from '@life-quest/core/rewards';
import { ChestAcquisitionHistory } from './ChestAcquisitionHistory';
import { useMobileGameStore } from '../stores/useMobileGameStore';

const mocks = vi.hoisted(() => ({ theme: 'light' as 'light' | 'dark' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}),
} }));
vi.mock('lucide-react-native', () => ({ History: () => null }));
vi.mock('../theme/usePalette', async () => {
    const { getMobileThemePalette } = await import('../theme/colors');
    return { usePalette: () => ({ palette: getMobileThemePalette(mocks.theme) }) };
});
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; testID?: string; accessibilityLabel?: string; accessibilityRole?: string;
        numberOfLines?: number; nestedScrollEnabled?: boolean; source?: unknown; style?: Record<string, unknown> };
    return {
        View: ({ children, accessibilityLabel }: Props) => createElement('div', { 'aria-label': accessibilityLabel }, children),
        Text: ({ children, accessibilityRole, numberOfLines, style }: Props) => createElement('span', {
            role: accessibilityRole === 'header' ? 'heading' : undefined, 'data-lines': numberOfLines, style: { color: style?.color as string },
        }, children),
        Image: ({ source }: Props) => createElement('img', { 'data-source': String(source) }),
        ScrollView: ({ children, testID, nestedScrollEnabled, style }: Props) => createElement('div', {
            'data-testid': testID, 'data-nested-scroll': nestedScrollEnabled, style: { maxHeight: style?.maxHeight as number },
        }, children),
    };
});

const item = (id = 'earned') => createEquipmentFromTemplate(id, EQUIPMENT_POOL.find((template) => template.id === 'wooden_sword')!);
const chest = (id: string, changes: Partial<ChestReward> = {}): ChestReward => ({ id, chestType: 'wood', label: id, opened: true, equipment: item(), ...changes });
let host: HTMLDivElement; let root: Root;
function mount() { act(() => root.render(createElement(StrictMode, {}, createElement(ChestAcquisitionHistory)))); }
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useMobileGameStore.setState({ ...createInitialGameStateSnapshot(), hasHydrated: true, pendingChestReveal: null, lastLevelUp: null });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

for (const theme of ['light', 'dark'] as const) describe(`${theme} acquisition history`, () => {
    beforeEach(() => { mocks.theme = theme; });
    it.each([{ chestQueue: [] }, { chestQueue: [chest('unopened', { opened: false })] }])('omits the whole section when there are no opened chests (%j)', ({ chestQueue }) => {
        useMobileGameStore.setState({ chestQueue }); mount(); expect(host.textContent).toBe('');
    });
    it('uses reverse queue order without mutating the store, hides unopened and has no reward actions', () => {
        const chestQueue = [chest('old'), chest('hidden', { opened: false }), chest('new')];
        useMobileGameStore.setState({ chestQueue }); mount();
        expect(host.textContent).toContain('獲得履歴 (2)');
        expect([...host.querySelectorAll('[aria-label]')].map((row) => row.getAttribute('aria-label'))).toEqual(['new、木の剣', 'old、木の剣']);
        expect(host.textContent).not.toContain('hidden'); expect(useMobileGameStore.getState().chestQueue).toBe(chestQueue);
        expect(chestQueue.map((entry) => entry.id)).toEqual(['old', 'hidden', 'new']);
        expect(host.querySelectorAll('button,[role="button"]')).toHaveLength(0);
        expect(useMobileGameStore.getState().equipment).toEqual([]); expect(useMobileGameStore.getState().pendingChestReveal).toBeNull();
    });
    it('shows equipment, starter character and missing-result records with an image fallback', () => {
        useMobileGameStore.setState({ chestQueue: [chest('starter', { chestType: 'blue', equipment: null, isStarterCharacter: true }),
            chest('unknown', { chestType: 'legacy' as ChestReward['chestType'], equipment: null }), chest('normal')] }); mount();
        expect(host.textContent).toContain('キャラクター獲得'); expect(host.textContent).toContain('—'); expect(host.textContent).toContain('木の剣');
        const images = host.querySelectorAll('img'); expect(images[1].dataset.source).toBe(images[0].dataset.source);
    });
    it.each(['sell', 'synthesize'] as const)('keeps the awarded snapshot after %s removes the original item', (action) => {
        const materials = ['earned', 'second', 'third'].map((id) => item(id));
        useMobileGameStore.setState({ chestQueue: [chest('snapshot')], equipment: materials }); mount();
        const snapshot = useMobileGameStore.getState().chestQueue;
        act(() => { const store = useMobileGameStore.getState(); if (action === 'sell') store.sellItem('earned'); else store.synthesizeItems(materials.map((material) => material.id)); });
        expect(useMobileGameStore.getState().equipment.some((entry) => entry.id === 'earned')).toBe(false);
        expect(useMobileGameStore.getState().chestQueue).toBe(snapshot); expect(host.textContent).toContain('木の剣');
    });
    it('reacts to opening, canonical replacement and account-data clearing without local caching', () => {
        useMobileGameStore.setState({ chestQueue: [chest('pending', { opened: false, equipment: null })] }); mount();
        act(() => { useMobileGameStore.getState().applyCloudChestResult('pending', 'canonical-item', 'iron_sword', false); });
        expect(host.textContent).toContain('鉄の剣'); expect(host.textContent).toContain('獲得履歴 (1)');
        act(() => { useMobileGameStore.setState({ chestQueue: [chest('replacement', { equipment: null })] }); });
        expect(host.textContent).not.toContain('鉄の剣'); expect(host.textContent).toContain('replacement');
        act(() => { useMobileGameStore.setState({ chestQueue: [] }); }); expect(host.textContent).toBe('');
    });
    it('preserves long labels and all retained rows in a bounded nested-scrolling card', () => {
        const name = 'とても長い獲得アイテム名'.repeat(12);
        useMobileGameStore.setState({ chestQueue: Array.from({ length: 80 }, (_, index) => chest(`宝箱${index}`, { equipment: { ...item(), name } })) }); mount();
        expect(host.textContent).toContain('獲得履歴 (80)'); expect(host.querySelectorAll('[aria-label]')).toHaveLength(80);
        expect(host.querySelector('[data-lines]')).toBeNull(); expect(host.textContent).toContain(name);
        const list = host.querySelector<HTMLElement>('[data-testid="chest-acquisition-history"]')!;
        expect(list.style.maxHeight).toBe('320px'); expect(list.dataset.nestedScroll).toBe('true');
    });
});
