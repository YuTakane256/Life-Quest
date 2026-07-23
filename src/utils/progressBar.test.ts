import { describe, expect, it } from 'vitest';
import { getProgressBarA11y } from './progressBar';

describe('getProgressBarA11y（再エクスポートのスモークテスト。ロジック本体はpackages/core/src/progressA11y.test.tsで検証）', () => {
    it('returns a normal state with the default "current / max" text', () => {
        expect(getProgressBarA11y(3, 5)).toEqual({ current: 3, max: 5, text: '3 / 5' });
    });

    it('uses a custom textFormat when provided', () => {
        const result = getProgressBarA11y(500, 30, (current, max) => `達成・${current}/${max}`);
        expect(result).toEqual({ current: 30, max: 30, text: '達成・30/30' });
    });
});
