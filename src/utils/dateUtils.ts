/**
 * 日付・時刻関連のユーティリティ関数
 */

import { TIME_CONFIG } from '../config/gameConfig';

/**
 * YYYY-MM-DD 形式の文字列を UTC ベースの Date にパースする（内部利用）。
 */
function parseYmd(dateStr: string): Date {
    if (!isValidYmd(dateStr)) {
        throw new RangeError(`Invalid YYYY-MM-DD date: ${dateStr}`);
    }
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

/**
 * UTC ベースの Date を YYYY-MM-DD 文字列にフォーマットする（内部利用）。
 */
function formatYmd(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function daysInUtcMonth(year: number, monthIndex: number): number {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * YYYY-MM-DD 形式かつ実在する日付かどうかを判定する。
 */
export function isValidYmd(dateStr: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (month < 1 || month > 12) return false;
    return day >= 1 && day <= daysInUtcMonth(year, month - 1);
}

/**
 * 日時文字列（ISO 8601 等）が Date としてパース可能かを判定する。
 */
export function isValidTimestamp(value: string): boolean {
    return !Number.isNaN(new Date(value).getTime());
}

/**
 * ISO 8601 日時文字列から日付部分（YYYY-MM-DD）を取り出す。
 * タイムゾーン変換は行わず、'T' より前をそのまま返す。
 */
export function toIsoDatePart(iso: string): string {
    return iso.split('T')[0];
}

/**
 * 現在時刻に JST オフセットを加えた Date を返す（内部利用）。
 * 返り値の UTC フィールド（getUTC*）を読むと JST のローカル日時に対応する。
 */
function getJstNow(): Date {
    return new Date(Date.now() + TIME_CONFIG.JST_OFFSET_HOURS * 60 * 60 * 1000);
}

/**
 * 現在のJSTの日付文字列を返す (YYYY-MM-DD)
 */
export function getTodayJST(): string {
    return formatYmd(getJstNow());
}

/**
 * 現在のJSTの時（0〜23）を返す
 */
export function getJSTHour(): number {
    return getJstNow().getUTCHours();
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
 * 期限が過ぎているか判定
 */
export function isOverdue(dueDate: string | null): boolean {
    if (!dueDate) return false;
    if (!isValidYmd(dueDate)) return false;
    const today = getTodayJST();
    return dueDate < today;
}

/**
 * YYYY-MM-DD の日付を今日基準の相対表示文字列に変換する
 * 例: 今日 / 明日 / 明後日 / 3日後 / 昨日 / 2日前
 */
export function formatRelativeDate(dateStr: string): string {
    if (!isValidYmd(dateStr)) return '';
    const todayMs = parseYmd(getTodayJST()).getTime();
    const dateMs = parseYmd(dateStr).getTime();
    const diffDays = Math.round((dateMs - todayMs) / (24 * 60 * 60 * 1000));

    if (diffDays === 0) return '今日';
    if (diffDays === 1) return '明日';
    if (diffDays === 2) return '明後日';
    if (diffDays === -1) return '昨日';
    if (diffDays > 0) return `${diffDays}日後`;
    return `${-diffDays}日前`;
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
 * YYYY-MM-DD の日付を指定日数だけずらして返す (YYYY-MM-DD)
 * 負の値で過去方向へずらせる
 */
export function shiftDate(dateStr: string, days: number): string {
    const date = parseYmd(dateStr);
    date.setUTCDate(date.getUTCDate() + days);
    return formatYmd(date);
}

/**
 * 繰り返し周期に応じて日付を1周期分進める (YYYY-MM-DD)。
 * 実体は @life-quest/core/tasks に移動し、Mobileと共有する（月末丸めルール込み）。
 */
export { addRecurrenceInterval } from '@life-quest/core/tasks';
