/**
 * Platform-neutral input normalization helpers shared by every client.
 */

export function clampString(value: string, maxLength: number): string {
    if (!Number.isFinite(maxLength) || maxLength <= 0) return '';

    const safeMaxLength = Math.floor(maxLength);
    if (value.length <= safeMaxLength) return value;
    return value.slice(0, safeMaxLength);
}
