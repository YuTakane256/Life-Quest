/**
 * ゲームバランスに関するすべての数値を一元管理する設定ファイル。
 * コンポーネント内にマジックナンバーを記述せず、必ずここから参照する。
 */

import {
    EQUIPMENT_RARITIES,
    type EquipmentTemplate,
    type Rarity,
} from '@life-quest/core/equipment';

export type { EquipmentSlot, EquipmentTemplate, Rarity } from '@life-quest/core/equipment';
export { XP_CONFIG } from '@life-quest/core/progression';

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

// ─── デイリーログインボーナス設定 ─────────────────────────────
export const LOGIN_BONUS_CONFIG = {
    /** ログインボーナスの基本XP（連続1日目） */
    BASE_XP: 20,

    /** 連続ログイン1日ごとに加算されるXP */
    XP_PER_STREAK_DAY: 5,

    /** 1回のログインボーナスで付与されるXPの上限 */
    MAX_XP: 100,

    /** 特別宝箱を付与する連続ログイン日数の周期（7日ごと） */
    SPECIAL_CHEST_INTERVAL: 7,

    /** 特別宝箱のタイプ */
    SPECIAL_CHEST_TYPE: 'gold' satisfies ChestType,

    /** 特別宝箱のラベル */
    SPECIAL_CHEST_LABEL: '7日連続ログイン記念の金の宝箱',
} as const;

// ─── キャラクター / バトル設定 ────────────────────────────────
export { CHARACTER_CONFIG } from '@life-quest/core/progression';

export const BATTLE_CONFIG = {
    /** ステージ別の敵データ */
    STAGES: [
        // ─── マップ1: 草原エリア (ステージ1〜10) ───
        { stage: 1, name: 'スライム', hp: 30, attack: 3, defense: 1, xpReward: 5 },
        { stage: 2, name: 'ゴブリン', hp: 50, attack: 5, defense: 2, xpReward: 10 },
        { stage: 3, name: '大コウモリ', hp: 70, attack: 7, defense: 3, xpReward: 15 },
        { stage: 4, name: '角ウサギ', hp: 90, attack: 9, defense: 4, xpReward: 20 },
        { stage: 5, name: '毒ヘビ', hp: 110, attack: 11, defense: 5, xpReward: 25 },
        { stage: 6, name: 'オーク', hp: 140, attack: 14, defense: 6, xpReward: 30 },
        { stage: 7, name: 'ワイルドボア', hp: 170, attack: 16, defense: 8, xpReward: 35 },
        { stage: 8, name: 'トレント', hp: 210, attack: 18, defense: 10, xpReward: 45 },
        { stage: 9, name: 'ダイアウルフ', hp: 260, attack: 22, defense: 12, xpReward: 55 },
        { stage: 10, name: 'ミノタウロス', hp: 350, attack: 28, defense: 15, xpReward: 80 },
        // ─── マップ2: 古城エリア (ステージ11〜20) ───
        { stage: 11, name: 'スケルトン', hp: 300, attack: 25, defense: 12, xpReward: 70 },
        { stage: 12, name: 'ゾンビ', hp: 380, attack: 28, defense: 14, xpReward: 85 },
        { stage: 13, name: 'ゴースト', hp: 350, attack: 32, defense: 10, xpReward: 95 },
        { stage: 14, name: 'ガーゴイル', hp: 450, attack: 30, defense: 20, xpReward: 110 },
        { stage: 15, name: 'リビングアーマー', hp: 550, attack: 28, defense: 25, xpReward: 125 },
        { stage: 16, name: 'ワイト', hp: 480, attack: 35, defense: 18, xpReward: 140 },
        { stage: 17, name: 'ゴーレム', hp: 650, attack: 32, defense: 28, xpReward: 160 },
        { stage: 18, name: 'ヴァンパイア', hp: 600, attack: 40, defense: 22, xpReward: 180 },
        { stage: 19, name: 'デーモン', hp: 750, attack: 45, defense: 25, xpReward: 210 },
        { stage: 20, name: 'デスナイト', hp: 1000, attack: 55, defense: 30, xpReward: 300 },
        // ─── マップ3: 天界エリア (ステージ21〜30) ───
        { stage: 21, name: 'ケルブ', hp: 900, attack: 50, defense: 30, xpReward: 250 },
        { stage: 22, name: 'ペガサス', hp: 1100, attack: 55, defense: 35, xpReward: 300 },
        { stage: 23, name: '光の精霊', hp: 1300, attack: 65, defense: 40, xpReward: 350 },
        { stage: 24, name: 'エンジェル', hp: 1500, attack: 70, defense: 45, xpReward: 400 },
        { stage: 25, name: 'ヴァルキリー', hp: 1800, attack: 80, defense: 50, xpReward: 500 },
        { stage: 26, name: 'グリフォン', hp: 2200, attack: 90, defense: 60, xpReward: 600 },
        { stage: 27, name: 'セラフ', hp: 2800, attack: 110, defense: 70, xpReward: 800 },
        { stage: 28, name: 'ホーリーナイト', hp: 3500, attack: 130, defense: 90, xpReward: 1000 },
        { stage: 29, name: 'アークエンジェル', hp: 4500, attack: 160, defense: 110, xpReward: 1500 },
        { stage: 30, name: '光の神', hp: 6000, attack: 200, defense: 150, xpReward: 2500 },
        // ─── マップ4: 深海エリア (ステージ31〜40) ───
        { stage: 31, name: 'ジャイアントクラブ', hp: 8000, attack: 250, defense: 180, xpReward: 3000 },
        { stage: 32, name: 'サハギン', hp: 10000, attack: 280, defense: 200, xpReward: 3500 },
        { stage: 33, name: 'マーマン', hp: 12000, attack: 320, defense: 220, xpReward: 4000 },
        { stage: 34, name: 'セイレーン', hp: 15000, attack: 350, defense: 250, xpReward: 5000 },
        { stage: 35, name: '水の精霊', hp: 18000, attack: 400, defense: 280, xpReward: 6000 },
        { stage: 36, name: 'キラーシャーク', hp: 22000, attack: 450, defense: 320, xpReward: 7500 },
        { stage: 37, name: 'シーサーペント', hp: 28000, attack: 500, defense: 380, xpReward: 9000 },
        { stage: 38, name: 'クラーケン', hp: 35000, attack: 600, defense: 450, xpReward: 12000 },
        { stage: 39, name: 'ウォータードラゴン', hp: 45000, attack: 750, defense: 550, xpReward: 16000 },
        { stage: 40, name: 'リヴァイアサン', hp: 60000, attack: 1000, defense: 700, xpReward: 25000 },
    ] as const,

    /** バトルのターン間隔（ミリ秒） */
    TURN_INTERVAL_MS: 1000,

    /** ダメージ計算式: attack - defense * DEFENSE_FACTOR (最低1ダメージ) */
    DEFENSE_FACTOR: 0.5,
    MIN_DAMAGE: 1,

    /** バトル履歴の最大保持件数（先頭追加・上限カット） */
    BATTLE_HISTORY_MAX_ENTRIES: 50,

    /** リプレイ時の1ログあたりの進行間隔（ミリ秒） */
    REPLAY_LOG_INTERVAL_MS: 600,
} as const;

// ─── マップ設定 ───────────────────────────────────────────────
export interface MapDefinition {
    id: number;
    name: string;
    theme: string;
    stageRange: [number, number]; // [start, end] (inclusive)
}

export const MAP_CONFIG: readonly MapDefinition[] = [
    { id: 1, name: '草原エリア', theme: 'grassland', stageRange: [1, 10] },
    { id: 2, name: '古城エリア', theme: 'castle', stageRange: [11, 20] },
    { id: 3, name: '天界エリア', theme: 'heaven', stageRange: [21, 30] },
    { id: 4, name: '深海エリア', theme: 'deep_sea', stageRange: [31, 40] },
] as const;

/** ステージ番号 → 敵画像キーのマッピング */
export const ENEMY_IMAGE_KEYS: Record<number, string> = {
    // マップ1: 草原
    1: 'slime',
    2: 'goblin',
    3: 'bat',
    4: 'rabbit',
    5: 'snake',
    6: 'orc',
    7: 'boar',     // プレースホルダー
    8: 'treant',   // プレースホルダー
    9: 'wolf',     // プレースホルダー
    10: 'minotaur', // プレースホルダー
    // マップ2: 古城
    11: 'skeleton',
    12: 'zombie',
    13: 'ghost',
    14: 'gargoyle',
    15: 'living_armor',
    16: 'wight',
    17: 'golem',
    18: 'vampire',
    19: 'demon',
    20: 'death_knight',
    // マップ3: 天界
    21: 'cherub',
    22: 'pegasus',
    23: 'light_elemental',
    24: 'angel',
    25: 'valkyrie',
    26: 'griffin',
    27: 'seraph',
    28: 'holy_knight',
    29: 'archangel',
    30: 'god_of_light',
    // マップ4: 深海
    31: 'giant_crab',
    32: 'sahagin',
    33: 'merman',
    34: 'siren',
    35: 'water_elemental',
    36: 'killer_shark',
    37: 'sea_serpent',
    38: 'kraken',
    39: 'water_dragon',
    40: 'leviathan',
};

// ─── 装備設定 ─────────────────────────────────────────────────
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

// ─── アイテム売却 / 合成設定 ──────────────────────────────────
/** レアリティ別の売却時XP */
export const SELL_XP_BY_RARITY: Record<Rarity, number> = {
    common: 5,
    uncommon: 20,
    rare: 70,
    epic: 240,
    legendary: 800,
};

/** レアリティの昇格順 */
export const RARITY_ORDER: readonly Rarity[] = EQUIPMENT_RARITIES;

export const SYNTHESIS_CONFIG = {
    /** 合成に必要な同レアリティアイテム数 */
    REQUIRED_COUNT: 3,
} as const;

// ─── UI 設定 ──────────────────────────────────────────────────
export const UI_CONFIG = {
    /** タスク完了時のUndo表示時間（ミリ秒） */
    UNDO_DURATION_MS: 5000,

    /** スナックバーのフェードアウト時間（ミリ秒） */
    SNACKBAR_FADE_MS: 300,

    /** 最大表示タスク件数（パフォーマンス用） */
    MAX_VISIBLE_TASKS: 100,

    // ─── ユーザー入力フィールドの文字数上限 ───
    /** タスク名の最大文字数 */
    MAX_TASK_NAME_LENGTH: 200,
    /** タグ文字列の最大文字数 */
    MAX_TAG_LENGTH: 50,
    /** 1タスクあたりの最大タグ数 */
    MAX_TAGS_PER_TASK: 20,
    /** 習慣名の最大文字数 */
    MAX_HABIT_NAME_LENGTH: 200,
    /** 習慣メモの最大文字数 */
    MAX_HABIT_MEMO_LENGTH: 500,
    /** キャラクター名の最大文字数 */
    MAX_CHARACTER_NAME_LENGTH: 30,
    /** サブタスク名の最大文字数 */
    MAX_SUBTASK_NAME_LENGTH: 200,
} as const;

// ─── 日付 / タイムゾーン設定 ──────────────────────────────────
export const TIME_CONFIG = {
    /** 日本時間オフセット (UTC+9) */
    JST_OFFSET_HOURS: 9,

    /** 習慣リセット時刻 (JST 0:00) */
    HABIT_RESET_HOUR_JST: 0,
} as const;

// ─── 通知設定 ─────────────────────────────────────────────────
export const NOTIFICATION_CONFIG = {
    /** タスク期限の何時間前から通知するか */
    TASK_DEADLINE_NOTICE_HOURS: 24,

    /** 未完了の習慣をリマインドするJST時刻（時） */
    HABIT_REMINDER_HOUR_JST: 20,

    /** 通知条件チェックの実行間隔（ミリ秒） */
    CHECK_INTERVAL_MS: 30 * 60 * 1000, // 30分

    /** 重複通知防止用に保持するタスクID数の上限 */
    MAX_NOTIFIED_TASK_IDS: 200,
} as const;
