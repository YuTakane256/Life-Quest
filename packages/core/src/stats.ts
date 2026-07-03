/**
 * 統計表示（ヒートマップ・サマリー）のための共有計算ロジック。
 *
 * ヒートマップの濃淡しきい値・日付グリッドの組み立てはWebのStatsPageと
 * 同一ルール。日付計算はUTCベースの純関数で、`today`（JSTのYYYY-MM-DD）を
 * 注入して決定的にテストできる。
 *
 * 集計はストアの現在データからの導出（completedAt / 習慣レコード）。
 * Webの統計ページはstatsStoreのイベントログを使っており、統合は
 * canonical統計契約の後続課題（Epic #473）。
 */
import { areAllHabitsComplete, type Habit, type HabitDailyRecord } from './habits';
import { XP_CONFIG } from './progression';
import { getSubtaskRewardXp, type Task } from './tasks';

// ─── ヒートマップ濃淡レベル ───────────────────────────────────

/** タスクXPを濃淡レベル(0-4)へ。しきい値はWebと同一（0 / 1-15 / 16-30 / 31-50 / 51+）。 */
export function getTaskHeatmapLevel(xp: number): number {
    if (xp <= 0) return 0;
    if (xp <= 15) return 1;
    if (xp <= 30) return 2;
    if (xp <= 50) return 3;
    return 4;
}

/** 習慣達成数を濃淡レベル(0-4)へ。全達成は常に最大（Webと同一）。 */
export function getHabitHeatmapLevel(count: number, allComplete: boolean): number {
    if (allComplete) return 4;
    if (count <= 0) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 2;
    return 3;
}

// ─── 日付グリッド ─────────────────────────────────────────────

function shiftYmd(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD の曜日 (0=日) をTZ非依存で返す。 */
function weekdayOf(date: string): number {
    return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** today で終わる過去 days 日分の日付配列 (YYYY-MM-DD、昇順)。 */
export function generateDateRange(days: number, today: string): string[] {
    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
        dates.push(shiftYmd(today, -i));
    }
    return dates;
}

/**
 * 日付を週ごと（日曜始まり・各週7要素）にグループ化する。
 * 先頭は曜日に合わせて '' でパディングする（Webと同一）。
 */
export function groupDatesByWeeks(dates: readonly string[]): string[][] {
    if (dates.length === 0) return [];
    const padded = [...Array<string>(weekdayOf(dates[0])).fill(''), ...dates];
    const weeks: string[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
        weeks.push(padded.slice(i, i + 7));
    }
    const lastWeek = weeks[weeks.length - 1];
    while (lastWeek.length < 7) lastWeek.push('');
    return weeks;
}

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/** 月の変わり目の週にラベルを付ける（Webと同一）。 */
export function getMonthLabels(weeks: readonly (readonly string[])[]): { label: string; weekIndex: number }[] {
    const labels: { label: string; weekIndex: number }[] = [];
    let lastMonth = '';
    weeks.forEach((week, weekIndex) => {
        const validDate = week.find((date) => date !== '');
        if (!validDate) return;
        const month = validDate.substring(5, 7);
        if (month !== lastMonth) {
            labels.push({ label: MONTH_LABELS[Number(month) - 1], weekIndex });
            lastMonth = month;
        }
    });
    return labels;
}

// ─── 集計 ─────────────────────────────────────────────────────

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO日時をJSTの YYYY-MM-DD へ。読めなければ null。 */
function toJstYmd(iso: string | null): string | null {
    if (!iso) return null;
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time)) return null;
    return new Date(time + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 完了タスク・完了サブタスクから、JST日付ごとの獲得XPを導出する。
 * XP額は報酬ルール（優先度XP・サブタスクは半分）と同一。
 */
export function buildTaskXpByDate(tasks: readonly Task[]): Record<string, number> {
    const xpByDate: Record<string, number> = {};
    const add = (date: string | null, xp: number): void => {
        if (date === null) return;
        xpByDate[date] = (xpByDate[date] ?? 0) + xp;
    };

    for (const task of tasks) {
        if (task.completed) {
            add(toJstYmd(task.completedAt), XP_CONFIG.REWARD_BY_PRIORITY[task.priority]);
        }
        for (const subtask of task.subtasks) {
            if (subtask.completed) {
                add(toJstYmd(subtask.completedAt), getSubtaskRewardXp(task.priority));
            }
        }
    }
    return xpByDate;
}

export interface HabitDayActivity {
    /** その日に達成した習慣数 */
    count: number;
    /** その日の全習慣達成（日次ボーナスと同じ判定） */
    allComplete: boolean;
}

/** 習慣レコードから、日付ごとの達成数と全達成フラグを導出する。 */
export function buildHabitActivityByDate(
    habits: readonly Habit[],
    records: readonly HabitDailyRecord[],
): Record<string, HabitDayActivity> {
    const activity: Record<string, HabitDayActivity> = {};
    const dates = new Set(records.filter((record) => record.completed).map((record) => record.date));
    for (const date of dates) {
        activity[date] = {
            count: records.filter((record) => record.date === date && record.completed).length,
            allComplete: areAllHabitsComplete(habits, records, date),
        };
    }
    return activity;
}
