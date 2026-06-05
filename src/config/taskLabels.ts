/**
 * Priority / Recurrence の表示用ラベル・色・ソート順を集約した共有定数。
 * 複数ページでタスク関連の表示を行うときの単一情報源として利用する。
 */
import type { Priority, Recurrence } from '../types';

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
