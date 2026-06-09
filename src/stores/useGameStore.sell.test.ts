import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { SELL_XP_BY_RARITY } from '../config/gameConfig';
import type { Equipment, Rarity } from '../types';

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
    return {
        id: 'eq-' + Math.random().toString(36).slice(2, 8),
        templateId: 'wooden_sword',
        name: '木の剣',
        slot: 'weapon',
        rarity: 'common',
        attackBonus: 2,
        defenseBonus: 0,
        hpBonus: 0,
        equipped: false,
        ...overrides,
    };
}

// addXp は副作用が大きいので、state ごと差し替えてモック関数に置き換える。
let addXpMock: ReturnType<typeof vi.fn>;
const originalAddXp = useGameStore.getState().addXp;

function reset() {
    localStorage.clear();
    addXpMock = vi.fn();
    useGameStore.setState({ equipment: [], addXp: addXpMock as unknown as typeof originalAddXp });
}

describe('useGameStore.sellItem', () => {
    beforeEach(() => reset());

    afterEach(() => {
        // テスト終了後、後続テストファイルのために addXp を元に戻す
        useGameStore.setState({ addXp: originalAddXp });
    });

    it('未装備の common アイテムを売却: XP 獲得 + equipment から削除', () => {
        useGameStore.setState({ equipment: [makeEquipment({ id: 'w', rarity: 'common', equipped: false })] });
        const got = useGameStore.getState().sellItem('w');
        expect(got).toBe(SELL_XP_BY_RARITY.common);
        expect(useGameStore.getState().equipment).toHaveLength(0);
        expect(addXpMock).toHaveBeenCalledWith(SELL_XP_BY_RARITY.common);
    });

    it('装備中のアイテムは売却できない (戻り値 0, 変化なし)', () => {
        useGameStore.setState({ equipment: [makeEquipment({ id: 'w', rarity: 'rare', equipped: true })] });
        const got = useGameStore.getState().sellItem('w');
        expect(got).toBe(0);
        expect(useGameStore.getState().equipment).toHaveLength(1);
        expect(addXpMock).not.toHaveBeenCalled();
    });

    it('存在しない id は 0 を返し state 変化なし', () => {
        useGameStore.setState({ equipment: [makeEquipment({ id: 'w' })] });
        const before = useGameStore.getState().equipment;
        const got = useGameStore.getState().sellItem('nope');
        expect(got).toBe(0);
        expect(useGameStore.getState().equipment).toEqual(before);
        expect(addXpMock).not.toHaveBeenCalled();
    });

    it('rarity ごとに対応する XP が返る', () => {
        const rarities: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
        const items = rarities.map((rarity, i) => makeEquipment({ id: `r${i}`, rarity, equipped: false }));
        useGameStore.setState({ equipment: items });
        for (let i = 0; i < rarities.length; i++) {
            const rarity = rarities[i];
            const got = useGameStore.getState().sellItem(`r${i}`);
            expect(got).toBe(SELL_XP_BY_RARITY[rarity]);
            expect(addXpMock).toHaveBeenLastCalledWith(SELL_XP_BY_RARITY[rarity]);
        }
        // すべて売却済み
        expect(useGameStore.getState().equipment).toHaveLength(0);
    });
});
