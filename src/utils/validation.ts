/**
 * 文字列を maxLength 以下に切り詰める。
 * すでに制限内ならそのまま返す。
 */
export function clampString(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength);
}
