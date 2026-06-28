import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_GACHA_COUNT, useGameStore } from './useGameStore';

describe('useGameStore gacha counter bounds', () => {
    beforeEach(() => {
        localStorage.clear();
        useGameStore.setState({ gachaCount: 0, chestQueue: [] });
    });

    it('上限到達後の加算は安全整数上限で飽和する', () => {
        useGameStore.setState({ gachaCount: MAX_GACHA_COUNT });

        useGameStore.getState().incrementGachaCount();

        expect(useGameStore.getState().gachaCount).toBe(MAX_GACHA_COUNT);
    });

    it('巨大なカウンタのマイルストーン確認を有限時間で終える', () => {
        useGameStore.setState({ gachaCount: MAX_GACHA_COUNT });

        expect(() => useGameStore.getState().checkGachaMilestones()).not.toThrow();
        expect(useGameStore.getState().chestQueue).toEqual([]);
    });

    it('通常のマイルストーンでは従来どおり宝箱を付与する', () => {
        useGameStore.setState({ gachaCount: 5 });

        useGameStore.getState().checkGachaMilestones();

        expect(useGameStore.getState().chestQueue).toHaveLength(1);
        expect(useGameStore.getState().chestQueue[0]).toMatchObject({
            chestType: 'blue',
            opened: false,
            isStarterCharacter: true,
        });
    });
});
