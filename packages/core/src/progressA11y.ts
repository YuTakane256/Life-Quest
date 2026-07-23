import { getHpDisplayState } from './hp.ts';

/**
 * プログレスバーのアクセシビリティ属性算出（プラットフォーム中立）。
 *
 * フィールド名はDOM（aria-valuenow等）・RN（accessibilityValueのnow等）
 * いずれの語彙にも寄せず、`getHpDisplayState`と同じ`current`/`max`の命名で
 * 揃える。各プラットフォームの呼び出し側がaria属性・accessibilityValueへの
 * マッピングを担う（`min`は両プラットフォームとも呼び出し側が0を付与する
 * 前提で、この型には含めない）。
 */
export interface ProgressA11y {
    current: number;
    max: number;
    text: string;
}

function nonNegativeFinite(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
}

/**
 * HPバー用。`current`/`max`をそのまま「N / M」形式のtextにする
 * （HPは残量を表すため、値そのものが意味を持つ）。
 */
export function getHpBarA11y(current: number, max: number): ProgressA11y {
    const hp = getHpDisplayState(current, max);
    return {
        current: hp.current,
        max: hp.max,
        text: `${hp.current} / ${hp.max}`,
    };
}

/**
 * 汎用プログレスバー用（XP・習慣達成・実績等）。HPと異なり「進捗の意味」
 * （残量か達成度か）はこの関数では扱わず、呼び出し側がその文脈の数値と
 * textの文言（`textFormat`）を渡す。
 */
export function getProgressBarA11y(
    current: number,
    max: number,
    textFormat?: (current: number, max: number) => string,
): ProgressA11y {
    const safeMax = nonNegativeFinite(max);
    if (safeMax === 0) {
        return { current: 0, max: 0, text: textFormat ? textFormat(0, 0) : '0 / 0' };
    }
    const clampedCurrent = Math.min(nonNegativeFinite(current), safeMax);
    return {
        current: clampedCurrent,
        max: safeMax,
        text: textFormat ? textFormat(clampedCurrent, safeMax) : `${clampedCurrent} / ${safeMax}`,
    };
}
