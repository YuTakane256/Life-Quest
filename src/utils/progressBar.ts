/**
 * 汎用プログレスバーのARIA progressbar属性算出（DOM専用のためWeb側に置く。
 * `hp.ts`の`getHpBarA11y`と対になる位置づけ）。
 *
 * HPは残量、XP/習慣/実績は達成度と意味が異なるため、valueNow/valueMaxの
 * 「意味」はこの関数では扱わない。呼び出し側がその文脈の数値を渡し、
 * valueTextの文言も呼び出し側がカスタマイズできるようにする
 * （例: 実績のunlocked時は数値ではなく達成タイトルを読み上げたい）。
 */
export interface ProgressBarA11y {
    valueNow: number;
    valueMax: number;
    valueText: string;
}

function nonNegativeFinite(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
}

export function getProgressBarA11y(
    valueNow: number,
    valueMax: number,
    valueTextFormat?: (now: number, max: number) => string,
): ProgressBarA11y {
    const safeMax = nonNegativeFinite(valueMax);
    if (safeMax === 0) {
        return { valueNow: 0, valueMax: 0, valueText: valueTextFormat ? valueTextFormat(0, 0) : '0 / 0' };
    }
    const clampedNow = Math.min(nonNegativeFinite(valueNow), safeMax);
    return {
        valueNow: clampedNow,
        valueMax: safeMax,
        valueText: valueTextFormat ? valueTextFormat(clampedNow, safeMax) : `${clampedNow} / ${safeMax}`,
    };
}
