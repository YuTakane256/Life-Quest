/**
 * StatsPage のヒートマップ／連続記録に使う計算ロジック。
 * 表示から切り離した純粋関数として単体テスト可能にする。
 */
import { shiftDate, toIsoDatePart } from './dateUtils';

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/** 日付セットから最長連続日数とその開始/終了日を返す */
export function computeLongestConsecutive(dateSet: Set<string>): { count: number; start: string; end: string } {
    const dates = [...dateSet].sort();
    if (dates.length === 0) return { count: 0, start: '', end: '' };
    let maxLen = 1;
    let maxStart = dates[0];
    let maxEnd = dates[0];
    let curLen = 1;
    let curStart = dates[0];
    for (let i = 1; i < dates.length; i++) {
        if (shiftDate(dates[i - 1], 1) === dates[i]) {
            curLen++;
        } else {
            curLen = 1;
            curStart = dates[i];
        }
        if (curLen > maxLen) {
            maxLen = curLen;
            maxStart = curStart;
            maxEnd = dates[i];
        }
    }
    return { count: maxLen, start: maxStart, end: maxEnd };
}

/** YYYY-MM-DD の曜日名を返す */
export function getWeekdayName(date: string): string {
    return WEEKDAY_NAMES[new Date(date + 'T00:00:00+09:00').getDay()];
}

/** タスクXPをヒートマップの濃淡レベル(0-4)に変換する */
export function getTaskLevel(xp: number): number {
    if (xp === 0) return 0;
    if (xp <= 15) return 1;
    if (xp <= 30) return 2;
    if (xp <= 50) return 3;
    return 4;
}

/** 習慣の達成数をヒートマップの濃淡レベル(0-4)に変換する */
export function getHabitLevel(count: number, allComplete: boolean): number {
    if (allComplete) return 4;
    if (count === 0) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 2;
    return 3;
}

/** 過去N日分の日付配列を生成 (YYYY-MM-DD、昇順) */
export function generateDateRange(days: number): string[] {
    const dates: string[] = [];
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() + jstOffset - i * 86400000);
        dates.push(toIsoDatePart(d.toISOString()));
    }
    return dates;
}

/** 日付を週ごとにグループ化（各週7要素、先頭は曜日に合わせてパディング） */
export function groupByWeeks(dates: string[]): string[][] {
    const weeks: string[][] = [];
    const firstDate = new Date(dates[0] + 'T00:00:00+09:00');
    const firstDay = firstDate.getDay();
    const paddedDates = [...Array(firstDay).fill(''), ...dates];

    for (let i = 0; i < paddedDates.length; i += 7) {
        weeks.push(paddedDates.slice(i, i + 7));
    }
    const lastWeek = weeks[weeks.length - 1];
    while (lastWeek.length < 7) lastWeek.push('');
    return weeks;
}

/** 月ラベル位置を計算 */
export function getMonthLabels(weeks: string[][]): { label: string; weekIndex: number }[] {
    const labels: { label: string; weekIndex: number }[] = [];
    let lastMonth = '';

    weeks.forEach((week, weekIndex) => {
        const validDate = week.find((d) => d !== '');
        if (!validDate) return;
        const month = validDate.substring(5, 7);
        if (month !== lastMonth) {
            labels.push({ label: MONTH_NAMES[parseInt(month, 10) - 1], weekIndex });
            lastMonth = month;
        }
    });
    return labels;
}
