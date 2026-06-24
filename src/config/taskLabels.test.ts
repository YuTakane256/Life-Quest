import { describe, expect, it } from 'vitest';
import type { Priority, Recurrence } from '../types';
import {
    PRIORITY_COLORS,
    PRIORITY_LABELS,
    PRIORITY_SORT_ORDER,
    RECURRENCE_LABELS,
    getPriorityColor,
    getPriorityLabel,
    getPrioritySortOrder,
    getRecurrenceLabel,
} from './taskLabels';

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high'];
const RECURRENCES: readonly Recurrence[] = ['none', 'daily', 'weekly', 'monthly'];

function sortedKeys(value: Record<string, unknown>): string[] {
    return Object.keys(value).sort();
}

describe('task display label config', () => {
    it('優先度の表示ラベル・色・並び順が全キーをカバーしている', () => {
        const priorityKeys = [...PRIORITIES].sort();

        expect(sortedKeys(PRIORITY_LABELS)).toEqual(priorityKeys);
        expect(sortedKeys(PRIORITY_COLORS)).toEqual(priorityKeys);
        expect(sortedKeys(PRIORITY_SORT_ORDER)).toEqual(priorityKeys);

        for (const priority of PRIORITIES) {
            expect(PRIORITY_LABELS[priority]).not.toHaveLength(0);
            expect(PRIORITY_COLORS[priority]).toMatch(/^var\(--color-priority-[a-z-]+\)$/);
            expect(PRIORITY_SORT_ORDER[priority]).toBeGreaterThanOrEqual(0);
        }
    });

    it('優先度の並び順は高い順に一意な連番になっている', () => {
        expect(PRIORITY_SORT_ORDER.high).toBeLessThan(PRIORITY_SORT_ORDER.medium);
        expect(PRIORITY_SORT_ORDER.medium).toBeLessThan(PRIORITY_SORT_ORDER.low);

        const sortRanks = Object.values(PRIORITY_SORT_ORDER);
        expect(new Set(sortRanks).size).toBe(PRIORITIES.length);
        expect([...sortRanks].sort()).toEqual([0, 1, 2]);
    });

    it('繰り返し設定の表示ラベルが全キーをカバーしている', () => {
        expect(sortedKeys(RECURRENCE_LABELS)).toEqual([...RECURRENCES].sort());

        for (const recurrence of RECURRENCES) {
            expect(RECURRENCE_LABELS[recurrence]).not.toHaveLength(0);
        }
    });

    it('安全な優先度ヘルパーは不正値を中優先度へ戻す', () => {
        expect(getPriorityLabel('high')).toBe(PRIORITY_LABELS.high);
        expect(getPriorityColor('high')).toBe(PRIORITY_COLORS.high);
        expect(getPrioritySortOrder('high')).toBe(PRIORITY_SORT_ORDER.high);

        expect(getPriorityLabel('urgent')).toBe(PRIORITY_LABELS.medium);
        expect(getPriorityColor(null)).toBe(PRIORITY_COLORS.medium);
        expect(getPrioritySortOrder(undefined)).toBe(PRIORITY_SORT_ORDER.medium);
    });

    it('安全な繰り返しヘルパーは不正値をなしへ戻す', () => {
        expect(getRecurrenceLabel('weekly')).toBe(RECURRENCE_LABELS.weekly);
        expect(getRecurrenceLabel('yearly')).toBe(RECURRENCE_LABELS.none);
        expect(getRecurrenceLabel(null)).toBe(RECURRENCE_LABELS.none);
    });
});
