import { describe, it, expect } from 'vitest';
import {
    createInitialCharacterState,
    createInitialGameStateSnapshot,
    GAME_STATE_LIMITS,
    sanitizeCharacterState,
    sanitizeChestQueue,
    sanitizeEquipmentCollection,
    sanitizeGameStateSnapshot,
    sanitizeRewardLedger,
} from './gameState';
import { CHARACTER_CONFIG } from './progression';
import type { Equipment } from './equipment';

function equipment(id: string, overrides: Partial<Equipment> = {}): Record<string, unknown> {
    return { id, templateId: 'wooden_sword', equipped: false, ...overrides };
}

describe('sanitizeCharacterState', () => {
    it('不正な入力には初期キャラクターを返す', () => {
        expect(sanitizeCharacterState(null)).toEqual(createInitialCharacterState());
        expect(sanitizeCharacterState('hack')).toEqual(createInitialCharacterState());
        expect(sanitizeCharacterState([])).toEqual(createInitialCharacterState());
    });

    it('totalXp からレベルと基礎ステータスを再計算し、細工された値を無効化する', () => {
        const result = sanitizeCharacterState({
            name: '勇者',
            avatar: 'male',
            totalXp: 30, // レベル2相当
            level: 99,
            baseAttack: 99999,
            baseDefense: 99999,
            baseMaxHp: 99999,
        });
        expect(result.level).toBe(2);
        expect(result.baseAttack).toBe(CHARACTER_CONFIG.INITIAL_STATS.attack + CHARACTER_CONFIG.STAT_PER_LEVEL.attack);
        expect(result.baseDefense).toBe(CHARACTER_CONFIG.INITIAL_STATS.defense + CHARACTER_CONFIG.STAT_PER_LEVEL.defense);
        expect(result.baseMaxHp).toBe(CHARACTER_CONFIG.INITIAL_STATS.maxHp + CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp);
        expect(result.name).toBe('勇者');
        expect(result.avatar).toBe('male');
    });

    it('名前は上限で切り詰め、不正なアバターは既定値に戻す', () => {
        const result = sanitizeCharacterState({
            name: 'あ'.repeat(100),
            avatar: 'dragon',
            totalXp: 0,
        });
        expect(result.name).toHaveLength(GAME_STATE_LIMITS.maxCharacterNameLength);
        expect(result.avatar).toBe(CHARACTER_CONFIG.INITIAL_STATS.avatar);
    });

    it('NaN や負の totalXp は既定値へフォールバックする', () => {
        expect(sanitizeCharacterState({ totalXp: Number.NaN }).totalXp).toBe(0);
        expect(sanitizeCharacterState({ totalXp: -100 }).totalXp).toBe(0);
    });
});

describe('sanitizeEquipmentCollection', () => {
    it('テンプレート不明・型不正の装備を除外し、ステータスをテンプレートから復元する', () => {
        const result = sanitizeEquipmentCollection([
            equipment('a', { attackBonus: 9999 } as Partial<Equipment>),
            { id: 'b', templateId: 'unknown_item' },
            'garbage',
            null,
        ]);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ id: 'a', templateId: 'wooden_sword', attackBonus: 2 });
    });

    it('ID重複を排除し、同一スロットの装備中は1つに絞る', () => {
        const result = sanitizeEquipmentCollection([
            equipment('a', { equipped: true }),
            equipment('a'),
            equipment('b', { equipped: true }), // 同じ weapon スロット
        ]);
        expect(result).toHaveLength(2);
        expect(result.filter((item) => item.equipped)).toHaveLength(1);
        expect(result[0].equipped).toBe(true);
    });

    it('上限を超えたら装備中を優先して残す', () => {
        const items = Array.from({ length: GAME_STATE_LIMITS.maxEquipmentItems + 10 }, (_, i) =>
            equipment(`item-${i}`, i === 0 ? { equipped: true } : {}));
        const result = sanitizeEquipmentCollection(items);
        expect(result).toHaveLength(GAME_STATE_LIMITS.maxEquipmentItems);
        expect(result.some((item) => item.id === 'item-0' && item.equipped)).toBe(true);
    });
});

describe('sanitizeChestQueue', () => {
    it('不正な宝箱を除外し、正常な宝箱を保持する', () => {
        const result = sanitizeChestQueue([
            { id: 'c1', chestType: 'wood', label: '木の宝箱', opened: false, equipment: null },
            { id: 'c2', chestType: 'plutonium', label: '??', opened: false, equipment: null },
            { id: 'c3', chestType: 'gold', label: '金の宝箱', opened: 'yes', equipment: 'sword' },
            42,
        ]);
        expect(result.map((chest) => chest.id)).toEqual(['c1', 'c3']);
        expect(result[1]).toMatchObject({ opened: false, equipment: null });
    });

    it('ID重複を排除する', () => {
        const chest = { id: 'dup', chestType: 'wood', label: 'x', opened: false, equipment: null };
        expect(sanitizeChestQueue([chest, chest])).toHaveLength(1);
    });

    it('上限を超えたら未開封を優先して残す', () => {
        const items = Array.from({ length: GAME_STATE_LIMITS.maxChestQueueItems + 10 }, (_, i) => ({
            id: `chest-${i}`,
            chestType: 'wood',
            label: 'x',
            opened: i !== 0, // 先頭だけ未開封
            equipment: null,
        }));
        const result = sanitizeChestQueue(items);
        expect(result).toHaveLength(GAME_STATE_LIMITS.maxChestQueueItems);
        expect(result.some((chest) => chest.id === 'chest-0')).toBe(true);
    });
});

describe('sanitizeRewardLedger', () => {
    it('文字列以外・空文字・重複を除外する', () => {
        const result = sanitizeRewardLedger({
            rewardedTaskIds: ['t1', 't1', '', 42, null, 't2'],
            habitBonusDates: ['2026-07-01', '2026-07-01', false],
        });
        expect(result.rewardedTaskIds).toEqual(['t1', 't2']);
        expect(result.habitBonusDates).toEqual(['2026-07-01']);
    });

    it('上限を超えたら古い方（先頭）から捨てる', () => {
        const ids = Array.from({ length: GAME_STATE_LIMITS.maxRewardedTaskIds + 5 }, (_, i) => `t${i}`);
        const result = sanitizeRewardLedger({ rewardedTaskIds: ids, habitBonusDates: [] });
        expect(result.rewardedTaskIds).toHaveLength(GAME_STATE_LIMITS.maxRewardedTaskIds);
        expect(result.rewardedTaskIds[0]).toBe('t5');
    });

    it('不正な入力には空の台帳を返す', () => {
        expect(sanitizeRewardLedger(undefined)).toEqual({ rewardedTaskIds: [], habitBonusDates: [] });
        expect(sanitizeRewardLedger('x')).toEqual({ rewardedTaskIds: [], habitBonusDates: [] });
    });
});

describe('sanitizeGameStateSnapshot', () => {
    it('不正な入力には初期スナップショットを返す', () => {
        expect(sanitizeGameStateSnapshot(null)).toEqual(createInitialGameStateSnapshot());
        expect(sanitizeGameStateSnapshot('broken')).toEqual(createInitialGameStateSnapshot());
    });

    it('各フィールドを正規化して返す', () => {
        const result = sanitizeGameStateSnapshot({
            character: { totalXp: 30 },
            equipment: [equipment('a')],
            chestQueue: [{ id: 'c1', chestType: 'wood', label: 'x', opened: false, equipment: null }],
            gachaCount: 7.9,
            rewardLedger: { rewardedTaskIds: ['t1'], habitBonusDates: [] },
        });
        expect(result.character.level).toBe(2);
        expect(result.equipment).toHaveLength(1);
        expect(result.chestQueue).toHaveLength(1);
        expect(result.gachaCount).toBe(7);
        expect(result.rewardLedger.rewardedTaskIds).toEqual(['t1']);
    });

    it('gachaCount の負数・NaN は 0 にする', () => {
        expect(sanitizeGameStateSnapshot({ gachaCount: -5 }).gachaCount).toBe(0);
        expect(sanitizeGameStateSnapshot({ gachaCount: Number.NaN }).gachaCount).toBe(0);
    });
});
