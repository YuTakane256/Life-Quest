/**
 * ゲームバランスに関するすべての数値を一元管理する設定ファイル。
 * コンポーネント内にマジックナンバーを記述せず、必ずここから参照する。
 */

import { EQUIPMENT_RARITIES, type Rarity } from '@life-quest/core/equipment';

export type { EquipmentSlot, EquipmentTemplate, Rarity } from '@life-quest/core/equipment';
export { XP_CONFIG } from '@life-quest/core/progression';

// ─── ガチャ (宝箱) / 装備コンテンツ設定 ───────────────────────
// 報酬コンテンツの実体は @life-quest/core/rewards に移動し、Mobileと共有する。
// 既存のimportパスを維持するためここから再エクスポートする。
export {
    EQUIPMENT_POOL,
    GACHA_CONFIG,
    SELL_XP_BY_RARITY,
    SYNTHESIS_CONFIG,
    type ChestType,
    type GachaMilestone,
} from '@life-quest/core/rewards';
import type { ChestType } from '@life-quest/core/rewards';

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

// バトル設定・マップ設定・敵画像キーは @life-quest/core/battle に移動し、
// Web/Mobile/Edge Function で共有する（#509）。既存のimportパスを維持するため再エクスポートする。
export {
    BATTLE_CONFIG,
    ENEMY_IMAGE_KEYS,
    MAP_CONFIG,
    type MapDefinition,
    type StageDefinition,
} from '@life-quest/core/battle';

// ─── アイテム売却 / 合成設定 ──────────────────────────────────
/** レアリティの昇格順 */
export const RARITY_ORDER: readonly Rarity[] = EQUIPMENT_RARITIES;

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
