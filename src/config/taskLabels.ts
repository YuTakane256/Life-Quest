/**
 * Priority / Recurrence の表示用ラベル・色・ソート順を集約した共有定数。
 * 複数ページでタスク関連の表示を行うときの単一情報源として利用する。
 */
import type { Priority, Recurrence } from '../types';

const DEFAULT_PRIORITY: Priority = 'medium';
const DEFAULT_RECURRENCE: Recurrence = 'none';
export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high'];
export const RECURRENCES: readonly Recurrence[] = ['none', 'daily', 'weekly', 'monthly'];

export const PRIORITY_LABELS: Record<Priority, string> = {
    low: '低',
    medium: '中',
    high: '高',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
    low: 'var(--color-priority-low)',
    medium: 'var(--color-priority-medium)',
    high: 'var(--color-priority-high)',
};

/** 優先度の並び順（高い順）。 sort 時の比較に使う。 */
export const PRIORITY_SORT_ORDER: Record<Priority, number> = {
    high: 0,
    medium: 1,
    low: 2,
};

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
    none: 'なし',
    daily: '毎日',
    weekly: '毎週',
    monthly: '毎月',
};

function resolvePriority(value: unknown): Priority {
    return PRIORITIES.includes(value as Priority) ? (value as Priority) : DEFAULT_PRIORITY;
}

function resolveRecurrence(value: unknown): Recurrence {
    return RECURRENCES.includes(value as Recurrence) ? (value as Recurrence) : DEFAULT_RECURRENCE;
}

export function getPriorityLabel(priority: unknown): string {
    return PRIORITY_LABELS[resolvePriority(priority)];
}

export function getPriorityColor(priority: unknown): string {
    return PRIORITY_COLORS[resolvePriority(priority)];
}

export function getPrioritySortOrder(priority: unknown): number {
    return PRIORITY_SORT_ORDER[resolvePriority(priority)];
}

export function getRecurrenceLabel(recurrence: unknown): string {
    return RECURRENCE_LABELS[resolveRecurrence(recurrence)];
}
