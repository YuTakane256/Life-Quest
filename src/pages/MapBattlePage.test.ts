import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebParityStorage } from '@life-quest/core/parityFixture';
import type { BattleHistoryEntry } from '../types';
import type { useGameStore } from '../stores/useGameStore';
import { MapBattlePage } from './MapBattlePage';

const refs = vi.hoisted(() => ({
    store: null as unknown as ReturnType<typeof useGameStore.getState>,
    status: 'idle' as 'idle' | 'syncing' | 'error' | 'done',
    start: vi.fn(), retry: vi.fn(), reset: vi.fn(),
}));
vi.mock('../stores/useGameStore', () => ({ useGameStore: () => refs.store }));
vi.mock('../stores/useBattleHistoryStore', () => ({
    useBattleHistoryStore: (select: (value: { history: BattleHistoryEntry[] }) => unknown) => select({ history: [] }),
}));
vi.mock('../hooks/useCloudBattleStart', () => ({ useCloudBattleStart: () => ({
    isStarting: false, startError: null, startStage: refs.start, retry: vi.fn(),
}) }));
vi.mock('../hooks/useCloudBattleResolve', () => ({ useCloudBattleResolve: () => ({
    resolveState: refs.status, granted: false, retry: refs.retry,
}) }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    vi.clearAllMocks();
    refs.status = 'idle';
    const game = JSON.parse(createWebParityStorage()['quest-board-game']).state;
    refs.store = {
        ...game,
        battle: { ...game.battle, status: 'victory', currentStage: 3, rewardMode: 'cloud', battleAttemptId: 'same-attempt',
            playerHp: 124, playerSnapshot: { name: '星見ユウ', level: 5, attack: 28, defense: 22, maxHp: 125 },
            enemy: { stage: 3, name: '大コウモリ', hp: 0, maxHp: 70, attack: 7, defense: 3, xpReward: 15 } },
        getEffectiveStats: () => ({ attack: 99, defense: 99, maxHp: 220 }),
        processBattleTurn: vi.fn(), resetBattle: refs.reset, advanceStage: vi.fn(), activateBattleSkill: vi.fn(),
    };
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const button = (label: string) => [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)!;
const render = () => act(async () => { root.render(createElement(MapBattlePage)); });

describe('Web battle result controls and fixed actor display', () => {
    it.each(['idle', 'syncing', 'error'] as const)('keeps next/map disabled for an unresolved cloud result in %s', async (status) => {
        refs.status = status;
        await render();
        expect(button('次へ').disabled).toBe(true);
        expect(button('マップへ').disabled).toBe(true);
        await act(async () => { button('次へ').click(); button('マップへ').click(); });
        expect(refs.start).not.toHaveBeenCalled();
        expect(refs.reset).not.toHaveBeenCalled();
        if (status === 'error') {
            await act(async () => button('再送').click());
            expect(refs.retry).toHaveBeenCalledTimes(1);
        }
    });
    it('restores an already-applied cloud victory without blocking navigation or granting XP', async () => {
        refs.store.battle.battleAttemptId = null;
        await render();
        expect(container.textContent).toContain('同期済み');
        expect(container.textContent).not.toContain('15 XP を獲得！');
        expect(button('次へ').disabled).toBe(false);
        await act(async () => button('次へ').click());
        expect(refs.start).toHaveBeenCalledWith(4, expect.any(Function));
    });
    it('uses the battle snapshot HP ceiling and labels the final-stage continuation as replay', async () => {
        refs.store.battle.rewardMode = 'local';
        refs.store.battle.currentStage = 40;
        await render();
        expect(container.querySelector('[aria-label="星見ユウ のHP"]')?.getAttribute('aria-valuemax')).toBe('125');
        expect(button('再挑戦').disabled).toBe(false);
        await act(async () => button('再挑戦').click());
        expect(refs.start).toHaveBeenCalledWith(40, expect.any(Function));
    });
    it('preserves the cloud defeat attempt until retrying its result', async () => {
        refs.store.battle.status = 'defeat'; refs.status = 'error';
        await render();
        expect(button('リトライ').disabled).toBe(true);
        expect(button('マップへ').disabled).toBe(true);
        await act(async () => button('再送').click());
        expect(refs.retry).toHaveBeenCalledTimes(1);
    });
});
