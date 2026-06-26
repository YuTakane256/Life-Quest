/**
 * 永続化データ（localStorage 由来の信頼できない unknown 値）を
 * 安全な形へ正規化するための型ガード／変換ヘルパー。
 *
 * 数値そのものの正規化は numeric.ts に委譲し、ここでは
 * 「unknown を検証してから正規化する」境界の責務だけを持つ。
 */
import { clamp, nonNegativeInteger } from './numeric';
import { isValidYmd, isValidTimestamp } from './dateUtils';

/** プレーンオブジェクト（非 null・非配列の object）かを判定する型ガード。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 有限数値かを判定する型ガード。 */
export function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * unknown を 0 以上の整数へ正規化する。
 * 有限数値でなければ fallback（既定 0）を返す。
 */
export function toNonNegativeInteger(value: unknown, fallback = 0): number {
    return isFiniteNumber(value) ? nonNegativeInteger(value) : fallback;
}

/**
 * unknown を [min, max] に収めた整数へ正規化する。
 * 有限数値でなければ fallback を返す。
 */
export function toBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
    return isFiniteNumber(value) ? clamp(Math.floor(value), min, max) : fallback;
}

/** unknown を YYYY-MM-DD 文字列へ。妥当でなければ null。 */
export function sanitizeNullableYmd(value: unknown): string | null {
    return typeof value === 'string' && isValidYmd(value) ? value : null;
}

/** unknown を ISO 日時文字列へ。妥当でなければ fallback（既定は現在時刻）。 */
export function sanitizeTimestamp(value: unknown, fallback: string = new Date().toISOString()): string {
    return typeof value === 'string' && isValidTimestamp(value) ? value : fallback;
}

/** unknown を ISO 日時文字列へ。妥当でなければ null。 */
export function sanitizeNullableTimestamp(value: unknown): string | null {
    return typeof value === 'string' && isValidTimestamp(value) ? value : null;
}
