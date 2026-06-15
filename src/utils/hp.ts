export interface HpDisplayState {
    current: number;
    max: number;
    ratio: number;
    widthPercent: string;
}

function sanitizeHpValue(value: number): number {
    return Number.isFinite(value) ? Math.floor(value) : 0;
}

export function getHpDisplayState(current: number, max: number): HpDisplayState {
    const safeMax = Math.max(0, sanitizeHpValue(max));
    const safeCurrent = Math.max(0, sanitizeHpValue(current));

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
