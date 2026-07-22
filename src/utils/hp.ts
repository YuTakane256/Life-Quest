export * from '../core/hp';

import { getHpDisplayState } from '../core/hp';

/** HPバーのARIA progressbar属性算出（DOM専用のためWeb側に置く。coreはプラットフォーム中立を保つ）。 */
export interface HpBarA11y {
    valueNow: number;
    valueMax: number;
    valueText: string;
}

export function getHpBarA11y(current: number, max: number): HpBarA11y {
    const hp = getHpDisplayState(current, max);
    return {
        valueNow: hp.current,
        valueMax: hp.max,
        valueText: `${hp.current} / ${hp.max}`,
    };
}
