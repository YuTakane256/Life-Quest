/**
 * 日付・時刻関連のユーティリティ関数
 */

import { TIME_CONFIG } from '../config/gameConfig';

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
