/**
 * JST日付ユーティリティ。実体は @life-quest/core/dates に移動し、Webと共有する
 * （従来はIntl+Asia/Tokyoで独自算出していたが、Web側の決定的な固定UTC+9演算方式へ統一した）。
 * 既存のimportパス・関数名（Mobile慣習の小文字jst）は再エクスポートで維持する。
 */
export { getJstHour, getTodayJst, isOverdue, isValidYmd, isoToJstYmd, shiftDate, toIsoDatePart } from '@life-quest/core/dates';
