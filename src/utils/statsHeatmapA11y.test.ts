import { describe, expect, it } from 'vitest';
import { getHeatmapCellLabel } from './statsHeatmapA11y';

describe('getHeatmapCellLabel', () => {
    it('日付と値の文言を結合する（tasksモード相当）', () => {
        expect(getHeatmapCellLabel('2025-07-24', '15 XP')).toBe('7月24日(木): 15 XP');
    });

    it('日付と値の文言を結合する（habitsモード相当、全達成）', () => {
        expect(getHeatmapCellLabel('2025-07-24', '3個 (全達成!)')).toBe('7月24日(木): 3個 (全達成!)');
    });

    it('値が0の日でも自然な文言になる', () => {
        expect(getHeatmapCellLabel('2025-07-24', '0 XP')).toBe('7月24日(木): 0 XP');
    });
});
