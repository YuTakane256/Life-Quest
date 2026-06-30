/**
 * Platform-neutral numeric normalization helpers shared by every client.
 */

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function nonNegativeInteger(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function nonNegativeRatio(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function positiveInteger(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}
