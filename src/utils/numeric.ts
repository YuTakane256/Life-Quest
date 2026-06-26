/**
 * 数値のサニタイズ・クランプ用ユーティリティ。
 * 永続化データや外部入力など、NaN / Infinity / 負値が混入しうる値を
 * 安全な範囲へ正規化するために各所で利用する。
 */

/**
 * value を [min, max] の範囲に収める。NaN は min 扱い。
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * 0 以上の整数へ正規化する。非有限値は 0。
 */
export function nonNegativeInteger(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * 0 以上の実数（比率など）へ正規化する。非有限値は 0。
 */
export function nonNegativeRatio(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * 1 以上の整数へ正規化する。非有限値・0・負値はすべて 1。
 * 除数（目標値など）のゼロ除算を防ぐ用途で使う。
 */
export function positiveInteger(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}
