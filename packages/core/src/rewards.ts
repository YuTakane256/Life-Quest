/**
 * タスク・習慣の達成に対する報酬コンテンツ（宝箱ガチャ・装備プール・売却/合成）の
 * 共有ドメイン。WebとMobileが同じ報酬ルールを参照する。
 *
 * このモジュールは純粋TSのみで構成し、React / Zustand / ブラウザAPIに依存しない。
 * 乱数が必要な関数は `random: () => number` を注入可能にして決定的にテストできる。
 */
import type { Equipment, EquipmentTemplate, Rarity } from './equipment.ts';

// ─── ガチャ (宝箱) 設定 ───────────────────────────────────────
export type ChestType = 'blue' | 'wood' | 'silver' | 'gold' | 'red_gold' | 'rainbow';

export interface GachaMilestone {
    /** このマイルストーンに到達するタスク消化数 */
    count: number;
    /** 宝箱のタイプ */
    chestType: ChestType;
    /** 表示名 */
    label: string;
}

/** ガチャ進行で獲得した宝箱。開封後に equipment がセットされる。 */
export interface ChestReward {
    id: string;
    chestType: ChestType;
    label: string;
    opened: boolean;
    equipment: Equipment | null;
    isStarterCharacter?: boolean;
    /** サーバー同期済みの宝箱か。未指定の旧ローカル保存データは local として扱う。 */
    origin?: 'local' | 'cloud';
}

export const GACHA_CONFIG = {
    /** マイルストーン定義（1サイクル内） */
    MILESTONES: [
        { count: 5, chestType: 'blue', label: '青色の宝箱' },
        { count: 10, chestType: 'wood', label: '木の宝箱' },
        { count: 25, chestType: 'wood', label: '木の宝箱' },
        { count: 50, chestType: 'silver', label: '銀の宝箱' },
        { count: 100, chestType: 'gold', label: '金の宝箱' },
    ] satisfies readonly GachaMilestone[],

    /** 100個ごとにループするサイクル長 */
    CYCLE_LENGTH: 100,

    /** 特殊マイルストーン */
    SPECIAL_MILESTONES: {
        500: { chestType: 'red_gold', label: '赤と金の宝箱' },
        1000: { chestType: 'rainbow', label: '虹色の宝箱' },
    } satisfies Record<number, { chestType: ChestType; label: string }>,

    /** 宝箱タイプ別の排出確率テーブル (rarity => 確率) */
    DROP_RATES: {
        blue: {
            common: 0,
            uncommon: 0,
            rare: 0,
            epic: 0,
            legendary: 0,
            starter_character: 1.0, // 初期キャラ確定
        },
        wood: {
            common: 0.60,
            uncommon: 0.30,
            rare: 0.08,
            epic: 0.02,
            legendary: 0,
        },
        silver: {
            common: 0.20,
            uncommon: 0.35,
            rare: 0.30,
            epic: 0.12,
            legendary: 0.03,
        },
        gold: {
            common: 0.05,
            uncommon: 0.15,
            rare: 0.30,
            epic: 0.35,
            legendary: 0.15,
        },
        red_gold: {
            common: 0,
            uncommon: 0.05,
            rare: 0.20,
            epic: 0.40,
            legendary: 0.35,
        },
        rainbow: {
            common: 0,
            uncommon: 0,
            rare: 0,
            epic: 0,
            legendary: 1.0, // 最高レア確定
        },
    } as const,
} as const;

// ─── 装備コンテンツ ───────────────────────────────────────────
export const EQUIPMENT_POOL: readonly EquipmentTemplate[] = [
    // Common
    { id: 'wooden_sword', name: '木の剣', slot: 'weapon', rarity: 'common', attackBonus: 2, defenseBonus: 0, hpBonus: 0 },
    { id: 'leather_armor', name: '革の鎧', slot: 'armor', rarity: 'common', attackBonus: 0, defenseBonus: 2, hpBonus: 5 },
    { id: 'wooden_ring', name: '木の指輪', slot: 'accessory', rarity: 'common', attackBonus: 1, defenseBonus: 1, hpBonus: 3 },
    // Uncommon
    { id: 'iron_sword', name: '鉄の剣', slot: 'weapon', rarity: 'uncommon', attackBonus: 5, defenseBonus: 0, hpBonus: 0 },
    { id: 'chain_mail', name: 'チェインメイル', slot: 'armor', rarity: 'uncommon', attackBonus: 0, defenseBonus: 5, hpBonus: 10 },
    { id: 'silver_ring', name: '銀の指輪', slot: 'accessory', rarity: 'uncommon', attackBonus: 2, defenseBonus: 2, hpBonus: 8 },
    // Rare
    { id: 'steel_blade', name: '鋼の刃', slot: 'weapon', rarity: 'rare', attackBonus: 10, defenseBonus: 0, hpBonus: 0 },
    { id: 'plate_armor', name: 'プレートアーマー', slot: 'armor', rarity: 'rare', attackBonus: 0, defenseBonus: 10, hpBonus: 20 },
    { id: 'gold_amulet', name: '金のアミュレット', slot: 'accessory', rarity: 'rare', attackBonus: 5, defenseBonus: 5, hpBonus: 15 },
    // Epic
    { id: 'mystic_staff', name: '神秘の杖', slot: 'weapon', rarity: 'epic', attackBonus: 18, defenseBonus: 3, hpBonus: 5 },
    { id: 'dragon_armor', name: 'ドラゴンアーマー', slot: 'armor', rarity: 'epic', attackBonus: 3, defenseBonus: 18, hpBonus: 35 },
    { id: 'phoenix_ring', name: 'フェニックスリング', slot: 'accessory', rarity: 'epic', attackBonus: 8, defenseBonus: 8, hpBonus: 25 },
    // Legendary
    { id: 'excalibur', name: 'エクスカリバー', slot: 'weapon', rarity: 'legendary', attackBonus: 30, defenseBonus: 5, hpBonus: 10 },
    { id: 'aegis_shield', name: 'イージスの盾', slot: 'armor', rarity: 'legendary', attackBonus: 5, defenseBonus: 30, hpBonus: 50 },
    { id: 'ring_of_god', name: '神の指輪', slot: 'accessory', rarity: 'legendary', attackBonus: 15, defenseBonus: 15, hpBonus: 40 },
];

/** レアリティ別の売却時XP */
export const SELL_XP_BY_RARITY: Record<Rarity, number> = {
    common: 5,
    uncommon: 20,
    rare: 70,
    epic: 240,
    legendary: 800,
};

export const SYNTHESIS_CONFIG = {
    /** 合成に必要な同レアリティアイテム数 */
    REQUIRED_COUNT: 3,
} as const;

// ─── ガチャ進行ロジック ───────────────────────────────────────

/**
 * ガチャカウントがマイルストーンに到達していれば宝箱情報を返す。
 * 特殊マイルストーン（500 / 1000）を優先し、それ以外はサイクル内の位置で判定する。
 */
export function getMilestoneAtCount(count: number): GachaMilestone | null {
    if (!Number.isInteger(count) || count <= 0) return null;

    const special = GACHA_CONFIG.SPECIAL_MILESTONES[count as keyof typeof GACHA_CONFIG.SPECIAL_MILESTONES];
    if (special) {
        return { count, chestType: special.chestType, label: special.label };
    }

    const posInCycle = count <= GACHA_CONFIG.CYCLE_LENGTH
        ? count
        : ((count - 1) % GACHA_CONFIG.CYCLE_LENGTH) + 1;
    const milestone = GACHA_CONFIG.MILESTONES.find((candidate) => candidate.count === posInCycle);
    return milestone ? { count, chestType: milestone.chestType, label: milestone.label } : null;
}

/**
 * 宝箱タイプの排出確率に従って装備テンプレートを抽選する。
 * スターターキャラ確定の宝箱（blue）は装備を排出しないため null を返す。
 * `random` は [0, 1) の乱数を返す関数（既定は Math.random）。
 */
export function rollEquipmentTemplate(
    chestType: ChestType,
    random: () => number = Math.random,
): EquipmentTemplate | null {
    const dropRates = GACHA_CONFIG.DROP_RATES[chestType];
    if (!dropRates) return null;
    if ('starter_character' in dropRates && dropRates.starter_character === 1.0) {
        return null;
    }

    const roll = random();
    let cumulative = 0;
    let selectedRarity: Rarity = 'common';
    for (const [rarity, rate] of Object.entries(dropRates)) {
        if (rarity === 'starter_character' || rate <= 0) continue;
        cumulative += rate;
        if (roll <= cumulative) {
            selectedRarity = rarity as Rarity;
            break;
        }
    }

    const candidates = EQUIPMENT_POOL.filter((template) => template.rarity === selectedRarity);
    if (candidates.length === 0) return null;
    const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
    return candidates[Math.max(0, index)];
}

/**
 * テンプレートIDからEquipmentTemplateを逆引きする。
 * サーバーが返す`templateId`（open_chest/synthesize_itemsのレスポンス）から
 * 装備実体を復元するために使う。未知のIDはnull。
 */
export function getEquipmentTemplateById(templateId: string): EquipmentTemplate | null {
    return EQUIPMENT_POOL.find((template) => template.id === templateId) ?? null;
}
