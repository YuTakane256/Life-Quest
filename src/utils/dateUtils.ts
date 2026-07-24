/**
 * 日付・時刻関連のユーティリティ関数
 */

// JST依存ロジック（isValidYmd/getTodayJST/getJSTHour/toIsoDatePart/shiftDate/isOverdue）は
// core/dates.ts へ移設し、Mobileと共有する。既存のimportパス・名前（Web慣習の大文字JST）は
// 再エクスポートで維持する。
export {
    getJstHour as getJSTHour,
    getTodayJst as getTodayJST,
    isOverdue,
    isValidYmd,
    isoToJstYmd,
    shiftDate,
    toIsoDatePart,
} from '../core/dates';
import { getTodayJst as getTodayJST, isValidYmd } from '../core/dates';

/**
 * 日時文字列（ISO 8601 等）が Date としてパース可能かを判定する。
 */
export function isValidTimestamp(value: string): boolean {
    return !Number.isNaN(new Date(value).getTime());
}

/**
 * ユニークIDを生成
 */
export function generateId(): string {
    return `${Date.now()}-${generateRandomIdSegment()}`;
}

let fallbackIdCounter = 0;

function generateFallbackIdSegment(): string {
    fallbackIdCounter = fallbackIdCounter >= Number.MAX_SAFE_INTEGER ? 1 : fallbackIdCounter + 1;

    let randomPart = '0';
    try {
        const randomValue = Math.random();
        if (Number.isFinite(randomValue) && randomValue >= 0) {
            randomPart = randomValue.toString(36).substring(2, 12) || '0';
        }
    } catch {
        // The monotonic suffix still keeps IDs unique within this runtime.
    }

    return `${randomPart}${fallbackIdCounter.toString(36).padStart(8, '0')}`;
}

function generateRandomIdSegment(): string {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.getRandomValues) {
        try {
            const bytes = new Uint8Array(8);
            cryptoApi.getRandomValues(bytes);
            return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('');
        } catch {
            return generateFallbackIdSegment();
        }
    }

    return generateFallbackIdSegment();
}

/**
 * YYYY-MM-DD の日付を今日基準の相対表示文字列に変換する
 * 例: 今日 / 明日 / 明後日 / 3日後 / 昨日 / 2日前
 */
export function formatRelativeDate(dateStr: string): string {
    if (!isValidYmd(dateStr)) return '';
    const todayMs = Date.parse(`${getTodayJST()}T00:00:00Z`);
    const dateMs = Date.parse(`${dateStr}T00:00:00Z`);
    const diffDays = Math.round((dateMs - todayMs) / (24 * 60 * 60 * 1000));

    if (diffDays === 0) return '今日';
    if (diffDays === 1) return '明日';
    if (diffDays === 2) return '明後日';
    if (diffDays === -1) return '昨日';
    if (diffDays > 0) return `${diffDays}日後`;
    return `${-diffDays}日前`;
}

/**
 * YYYY-MM-DD の日付を「7月24日(木)」のようなJST基準の読み上げ向け表示に変換する。
 * ヒートマップ系UI（StatsPage・HabitHeatmapModal）のaria-label/表示文言で共有する。
 */
export function formatHeatmapDate(date: string): string {
    // timeZoneを明示しないとIntl.DateTimeFormatは実行環境のローカルタイムゾーンで
    // 表示してしまい、UTC等のCI環境ではJSTから1日ズレる（実際にCIで検出したバグ）。
    return new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' })
        .format(new Date(`${date}T00:00:00+09:00`));
}

/**
 * ISO 8601 タイムスタンプを「たった今 / N分前 / N時間前 / N日前 / YYYY/MM/DD」の相対表示にする。
 * 未来時刻が渡されたら「たった今」扱い。
 */
export function formatRelativeTime(iso: string): string {
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return '';
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
    if (diffSec < 60) return 'たった今';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}分前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}時間前`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}日前`;
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
}

/**
 * 繰り返し周期に応じて日付を1周期分進める (YYYY-MM-DD)。
 * 実体は @life-quest/core/tasks に移動し、Mobileと共有する（月末丸めルール込み）。
 */
export { addRecurrenceInterval } from '@life-quest/core/tasks';
