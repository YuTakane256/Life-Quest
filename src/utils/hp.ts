import { nonNegativeInteger } from './numeric';

export interface HpDisplayState {
    current: number;
    max: number;
    ratio: number;
    widthPercent: string;
}

export function getHpDisplayState(current: number, max: number): HpDisplayState {
    const safeMax = nonNegativeInteger(max);
    const safeCurrent = nonNegativeInteger(current);

    if (safeMax === 0) {
        return {
            current: 0,
            max: 0,
            ratio: 0,
            widthPercent: '0%',
        };
    }

    const clampedCurrent = Math.min(safeCurrent, safeMax);
    const ratio = clampedCurrent / safeMax;

    return {
        current: clampedCurrent,
        max: safeMax,
        ratio,
        widthPercent: `${ratio * 100}%`,
    };
}
