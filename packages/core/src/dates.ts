/**
 * JSTに依存する日付・時刻ロジックの共有ルール。
 * Web/Mobileでこれまで別々に実装されていた（Webは固定UTC+9時間オフセット演算、
 * Mobileは`Intl`+`Asia/Tokyo`）。JSTは夏時間を持たないため両者の結果は常に一致するが、
 * 実装が2つあること自体が将来の修正漏れリスクになるため、決定的で環境（ICU）に
 * 依存しないWeb方式へこちらへ統一する。
 */

/** JSTはUTC+9固定（夏時間なし）。 */
const JST_OFFSET_HOURS = 9;

function daysInUtcMonth(year: number, monthIndex: number): number {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** YYYY-MM-DD 形式かつ実在する日付かどうかを判定する。 */
export function isValidYmd(dateStr: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (month < 1 || month > 12) return false;
    return day >= 1 && day <= daysInUtcMonth(year, month - 1);
}

/** YYYY-MM-DD 形式の文字列を UTC ベースの Date にパースする（内部利用）。 */
function parseYmd(dateStr: string): Date {
    if (!isValidYmd(dateStr)) {
        throw new RangeError(`Invalid YYYY-MM-DD date: ${dateStr}`);
    }
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

/** UTC ベースの Date を YYYY-MM-DD 文字列にフォーマットする（内部利用）。 */
function formatYmd(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 現在時刻に JST オフセットを加えた Date を返す（内部利用）。
 * 返り値の UTC フィールド（getUTC*）を読むと JST のローカル日時に対応する。
 */
function getJstNow(): Date {
    return new Date(Date.now() + JST_OFFSET_HOURS * 60 * 60 * 1000);
}

/** 現在のJSTの日付文字列を返す (YYYY-MM-DD)。 */
export function getTodayJst(): string {
    return formatYmd(getJstNow());
}

/** 現在のJSTの時（0〜23）を返す。 */
export function getJstHour(): number {
    return getJstNow().getUTCHours();
}

/**
 * ISO 8601 日時文字列から日付部分（YYYY-MM-DD）を取り出す。
 * タイムゾーン変換は行わず、'T' より前をそのまま返す
 * （タスク完了時刻などUTC生成されたcompletedAtの「その日」を機械的に切り出す用途）。
 */
export function toIsoDatePart(iso: string): string {
    return iso.split('T')[0];
}

/**
 * YYYY-MM-DD の日付を指定日数だけずらして返す (YYYY-MM-DD)。
 * 負の値で過去方向へずらせる。
 */
export function shiftDate(dateStr: string, days: number): string {
    const date = parseYmd(dateStr);
    date.setUTCDate(date.getUTCDate() + days);
    return formatYmd(date);
}

/** 期限（YYYY-MM-DD）が現在のJSTの今日より前かどうかを判定する。 */
export function isOverdue(dueDate: string | null): boolean {
    if (!dueDate) return false;
    if (!isValidYmd(dueDate)) return false;
    return dueDate < getTodayJst();
}
