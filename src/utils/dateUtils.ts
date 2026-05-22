/**
 * 日付・時刻関連のユーティリティ関数
 */

import { TIME_CONFIG } from '../config/gameConfig';
import type { Recurrence } from '../types';

/**
 * 現在のJSTの日付文字列を返す (YYYY-MM-DD)
 */
export function getTodayJST(): string {
    const now = new Date();
    const jstOffset = TIME_CONFIG.JST_OFFSET_HOURS * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const jstMinutes = utcMinutes + jstOffset;

    const jstDate = new Date(now);
    if (jstMinutes >= 24 * 60) {
        jstDate.setUTCDate(jstDate.getUTCDate() + 1);
    } else if (jstMinutes < 0) {
        jstDate.setUTCDate(jstDate.getUTCDate() - 1);
    }

    const year = jstDate.getUTCFullYear();
    const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(jstDate.getUTCDate()).padStart(2, '0');

    // JSTの日付境界を正確に計算
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
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
    const [ty, tm, td] = getTodayJST().split('-').map(Number);
    const [dy, dm, dd] = dateStr.split('-').map(Number);
    const todayMs = Date.UTC(ty, tm - 1, td);
    const dateMs = Date.UTC(dy, dm - 1, dd);
    const diffDays = Math.round((dateMs - todayMs) / (24 * 60 * 60 * 1000));

    if (diffDays === 0) return '今日';
    if (diffDays === 1) return '明日';
    if (diffDays === 2) return '明後日';
    if (diffDays === -1) return '昨日';
    if (diffDays > 0) return `${diffDays}日後`;
    return `${-diffDays}日前`;
}

/**
 * YYYY-MM-DD の日付を指定日数だけずらして返す (YYYY-MM-DD)
 * 負の値で過去方向へずらせる
 */
export function shiftDate(dateStr: string, days: number): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 繰り返し周期に応じて日付を1周期分進める (YYYY-MM-DD)
 * monthly で日付が翌月に存在しない場合（例: 1/31 → 2月）はJSの繰り上げ仕様に従う
 */
export function addRecurrenceInterval(dateStr: string, recurrence: Recurrence): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (recurrence === 'daily') {
        date.setUTCDate(date.getUTCDate() + 1);
    } else if (recurrence === 'weekly') {
        date.setUTCDate(date.getUTCDate() + 7);
    } else if (recurrence === 'monthly') {
        date.setUTCMonth(date.getUTCMonth() + 1);
    }

    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
