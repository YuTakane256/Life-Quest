/**
 * 文字列を maxLength 以下に切り詰める。
 * すでに制限内ならそのまま返す。
 */
export function clampString(value: string, maxLength: number): string {
    if (!Number.isFinite(maxLength) || maxLength <= 0) return '';

    const safeMaxLength = Math.floor(maxLength);
    if (value.length <= safeMaxLength) return value;
    return value.slice(0, safeMaxLength);
}
