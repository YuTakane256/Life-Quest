/**
 * 日付・時刻関連のユーティリティ関数
 */

import { TIME_CONFIG } from '../config/gameConfig';
import type { Recurrence } from '../types';

/**
 * YYYY-MM-DD 形式の文字列を UTC ベースの Date にパースする（内部利用）。
 */
function parseYmd(dateStr: string): Date {
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
 * 現在のJSTの日付文字列を返す (YYYY-MM-DD)
 */
export function getTodayJST(): string {
    const jstOffsetMs = TIME_CONFIG.JST_OFFSET_HOURS * 60 * 60 * 1000;
    const jstNow = new Date(Date.now() + jstOffsetMs);
    const y = jstNow.getUTCFullYear();
    const m = String(jstNow.getUTCMonth() + 1).padStart(2, '0');
    const d = String(jstNow.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 現在のJSTの時（0〜23）を返す
 */
export function getJSTHour(): number {
    const now = new Date();
    const jstMs = now.getTime() + TIME_CONFIG.JST_OFFSET_HOURS * 60 * 60 * 1000;
    return new Date(jstMs).getUTCHours();
}

/**
 * ユニークIDを生成
 */
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 期限が過ぎているか判定
 */
export function isOverdue(dueDate: string | null): boolean {
    if (!dueDate) return false;
    const today = getTodayJST();
    return dueDate < today;
}

/**
 * YYYY-MM-DD の日付を今日基準の相対表示文字列に変換する
 * 例: 今日 / 明日 / 明後日 / 3日後 / 昨日 / 2日前
 */
export function formatRelativeDate(dateStr: string): string {
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
 * 繰り返し周期に応じて日付を1周期分進める (YYYY-MM-DD)
 * monthly で日付が翌月に存在しない場合（例: 1/31 → 2月）は対象月の末日に丸める
 */
export function addRecurrenceInterval(dateStr: string, recurrence: Recurrence): string {
    const date = parseYmd(dateStr);

    if (recurrence === 'daily') {
        date.setUTCDate(date.getUTCDate() + 1);
    } else if (recurrence === 'weekly') {
        date.setUTCDate(date.getUTCDate() + 7);
    } else if (recurrence === 'monthly') {
        const targetFirst = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
        const targetYear = targetFirst.getUTCFullYear();
        const targetMonth = targetFirst.getUTCMonth();
        const targetDay = Math.min(date.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
        return formatYmd(new Date(Date.UTC(targetYear, targetMonth, targetDay)));
    }

    return formatYmd(date);
}
