import { formatHeatmapDate } from './dateUtils';

/**
 * ヒートマップセルのaria-label文言を組み立てる。値の文言（"15 XP"等）は
 * 既にtasks/habitsモードで分岐済みのtooltipTextをそのまま受け取り、
 * ここではmode分岐を再実装しない（ロジックの二重化を避けるため）。
 */
export function getHeatmapCellLabel(date: string, valueText: string): string {
    return `${formatHeatmapDate(date)}: ${valueText}`;
}
